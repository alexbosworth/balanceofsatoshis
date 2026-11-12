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
const {broadcastChainTransaction} = require('ln-service');
const {createChainAddress} = require('ln-service');
const {createInvoice} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getInvoices} = require('ln-service');
const {getMasterPublicKeys} = require('ln-service');
const {getSharedUtxos} = require('goldengate');
const {lightningLabsSwapAuth} = require('goldengate');
const {lightningLabsSwapService} = require('goldengate');
const {pay} = require('ln-service');
const {sendToChainAddress} = require('ln-service');
const {setupChannel} = require('ln-docker-daemons');
const {spawnLightningCluster} = require('ln-docker-daemons');
const {spendSharedUtxos} = require('goldengate');

const decodeSwapInRecovery = require('./../../swaps/decode_swap_in_recovery');
const {sharedAddressKeyFamily} = require('./../../swaps/constants');
const {spawnSwapServer} = require('./../macros');
const {swapIn} = require('./../../swaps');

const capacity = 1e6;
const feeRate = 2;
const giftTokens = 1e5;
const interval = 1000;
const log = () => {};
const maturity = 100;
const maxFee = 5000;
const miningIntervalMs = 2000;
const network = 'btcregtest';
const probeTokens = 1;
const rejected = [503, 'SwapServiceRejectedSwapInDeposits'];
const size = 2;
const taprootDerivationPath = `m/86'/0'/0'`;
const times = 300;
const tokens = 250000;

// Swapping in should fail when the service rejects the deposit
test(`Swap in deposit is rejected by the service`, async () => {
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

    const swapServer = await spawnSwapServer({
      is_rejecting_deposits: true,
      lnd: server.lnd,
      logger: {error: log, info: log},
    });

    const messages = [];

    const logger = {error: log, info: message => messages.push(message)};

    // Blocks confirm the deposit and then the withdraw of the deposit
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

      // The service rejects the deposit instead of paying for it
      await rejects(swap, rejected, 'Swap in fails when deposit is rejected');

      // The invoice of the rejected swap is canceled so it cannot be paid
      const {invoices} = await getInvoices({lnd: alice.lnd});

      const invoice = invoices.find(n => n.description.startsWith('Swap in'));

      ok(!!invoice && !!invoice.is_canceled, 'Swap invoice is canceled');

      const recovery = decodeSwapInRecovery({recovery: shown.recovery_secret});

      // The rejected deposit is left at the shared address
      const {utxos} = await getSharedUtxos({
        address,
        network,
        lnd: alice.lnd,
        min_height: recovery.start_height,
      });

      ok(!!utxos.find(n => n.tokens === tokens), 'Deposit is left');

      // The rejected deposit is withdrawn cooperatively with the service
      const {metadata} = lightningLabsSwapAuth({
        macaroon: recovery.macaroon,
        preimage: recovery.preimage,
      });

      const {service} = lightningLabsSwapService({
        network,
        socket: swapServer.socket,
      });

      const sweepAddress = await createChainAddress({lnd: alice.lnd});

      const withdraw = await spendSharedUtxos({
        metadata,
        network,
        service,
        utxos,
        expiry: recovery.expiry,
        fee_tokens_per_vbyte: feeRate,
        key_family: sharedAddressKeyFamily,
        key_index: recovery.index,
        lnd: alice.lnd,
        service_public_key: recovery.service_public_key,
        sweep_address: sweepAddress.address,
      });

      await broadcastChainTransaction({
        lnd: alice.lnd,
        transaction: withdraw.transaction,
      });

      await alice.generate({});

      await asyncRetry({interval, times}, async () => {
        const {transactions} = await getChainTransactions({lnd: alice.lnd});

        const tx = transactions.find(n => n.id === withdraw.id);

        if (!tx || !tx.is_confirmed) {
          throw new Error('WaitingForWithdrawToConfirm');
        }
      });

      service.close();
    } finally {
      clearInterval(mining);

      swapServer.kill({});
    }
  } finally {
    await kill({});
  }
});
