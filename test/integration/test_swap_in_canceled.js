const {equal} = require('node:assert').strict;
const {join} = require('node:path');
const {ok} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

// The swap server certificate is self-signed, it is trusted before gRPC loads
process.env.GRPC_DEFAULT_SSL_ROOTS_FILE_PATH = join(
  __dirname,
  '..',
  'fixtures',
  'swap_server.cert'
);

const asyncRetry = require('async/retry');
const {createInvoice} = require('ln-service');
const {getInvoices} = require('ln-service');
const {getMasterPublicKeys} = require('ln-service');
const {getSharedUtxos} = require('goldengate');
const {pay} = require('ln-service');
const {sendToChainAddress} = require('ln-service');
const {setupChannel} = require('ln-docker-daemons');
const {spawnLightningCluster} = require('ln-docker-daemons');

const decodeSwapInRecovery = require('./../../swaps/decode_swap_in_recovery');
const {spawnSwapServer} = require('./../macros');
const {swapIn} = require('./../../swaps');

const capacity = 1e6;
const failedPush = [503, 'UnexpectedErrorPushingFallbackSigs'];
const giftTokens = 1e5;
const interval = 1000;
const log = () => {};
const maturity = 100;
const maxFee = 5000;
const miningIntervalMs = 2000;
const network = 'btcregtest';
const probeTokens = 1;
const size = 2;
const taprootDerivationPath = `m/86'/0'/0'`;
const times = 300;
const tokens = 250000;

// Swapping in should cancel a swap that fails before it is signed
test(`Swap in that fails before it is signed is canceled`, async () => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [alice, server] = nodes;

  try {
    const {keys} = await getMasterPublicKeys({lnd: alice.lnd});

    // Exit early when taproot is not supported
    if (!keys.find(n => n.derivation_path === taprootDerivationPath)) {
      return;
    }

    // Alice pays the swap server node for its API token with gifted tokens
    await setupChannel({
      capacity,
      generate: server.generate,
      give_tokens: giftTokens,
      lnd: server.lnd,
      to: alice,
    });

    // Wait for the channel to be usable to pay the swap server node
    await asyncRetry({interval, times}, async () => {
      const {request} = await createInvoice({
        lnd: server.lnd,
        tokens: probeTokens,
      });

      await pay({request, lnd: alice.lnd});
    });

    // Alice deposits mined coins
    await alice.generate({count: maturity});

    const serverMessages = [];

    const swapServer = await spawnSwapServer({
      is_failing_fallback_sigs: true,
      lnd: server.lnd,
      logger: {error: log, info: message => serverMessages.push(message)},
    });

    const messages = [];

    const logger = {error: log, info: message => messages.push(message)};

    // Blocks confirm the deposit
    const mining = setInterval(() => {
      return alice.generate({}).catch(log);
    },
    miningIntervalMs);

    try {
      const swap = swapIn({
        fetch,
        logger,
        tokens,
        lnd: alice.lnd,
        max_fee: maxFee,
        socket: swapServer.socket,
      });

      // Wait for the shared address to deposit to, or for the swap to fail
      const shown = await Promise.race([
        swap,
        asyncRetry({interval, times}, async () => {
          const message = messages.find(n => !!n.swap);

          if (!message) {
            throw new Error('WaitingForSharedAddressToDepositTo');
          }

          return message;
        }),
      ]);

      const address = shown.swap.send_to_address;

      await sendToChainAddress({address, tokens, lnd: alice.lnd});

      // The service fails to take the signatures for the swap fallback
      await rejects(swap, failedPush, 'Swap in fails when signing fails');

      // The invoice of the canceled swap is canceled too
      const {invoices} = await getInvoices({lnd: alice.lnd});

      const invoice = invoices.find(n => n.description.startsWith('Swap in'));

      ok(!!invoice && !!invoice.is_canceled, 'Swap invoice is canceled');

      // The swap is canceled with the service
      const canceled = messages.find(n => !!n.canceled_swap_in);

      ok(!!canceled, 'Swap that failed before signing is canceled');

      const serverCanceled = serverMessages.find(n => !!n.canceled_swap_in);

      ok(!!serverCanceled, 'Service has the swap canceled');

      equal(
        serverCanceled.canceled_swap_in,
        canceled.canceled_swap_in,
        'Service canceled the swap that failed'
      );

      const recovery = decodeSwapInRecovery({recovery: shown.recovery_secret});

      // The deposit of the canceled swap is left at the shared address
      const {utxos} = await getSharedUtxos({
        address,
        network,
        lnd: alice.lnd,
        min_height: recovery.start_height,
      });

      ok(!!utxos.find(n => n.tokens === tokens), 'Deposit is left');
    } finally {
      clearInterval(mining);

      swapServer.kill({});
    }
  } finally {
    await kill({});
  }
});
