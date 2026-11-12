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

const {addressForScript} = require('goldengate');
const asyncRetry = require('async/retry');
const {createChainAddress} = require('ln-service');
const {createInvoice} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getHeight} = require('ln-service');
const {getInvoices} = require('ln-service');
const {getMasterPublicKeys} = require('ln-service');
const {getPublicKey} = require('ln-service');
const {getSharedUtxos} = require('goldengate');
const {pay} = require('ln-service');
const {sendToChainAddress} = require('ln-service');
const {setupChannel} = require('ln-docker-daemons');
const {spawnLightningCluster} = require('ln-docker-daemons');
const {swapScriptV2} = require('goldengate');

const decodeSwapInRecovery = require('./../../swaps/decode_swap_in_recovery');
const {sharedAddressKeyFamily} = require('./../../swaps/constants');
const {spawnSwapServer} = require('./../macros');
const {swapIn} = require('./../../swaps');

const capacity = 1e6;
const giftTokens = 1e5;
const interval = 1000;
const log = () => {};
const maturity = 100;
const maxFee = 5000;
const miningIntervalMs = 2000;
const network = 'btcregtest';
const notPaid = [503, 'SwapInHtlcTimedOutWithoutPayment'];
const notRefundableError = 'ExpectedExpiredDepositsToRefund';
const probeTokens = 1;
const size = 2;
const taprootDerivationPath = `m/86'/0'/0'`;
const times = 300;
const tokens = 250000;

// Swapping in should refund a swap the service takes without paying for
test(`Swap in that is not paid is refunded`, async () => {
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
      is_publishing_fallback: true,
      lnd: server.lnd,
      logger: {error: log, info: log},
    });

    const messages = [];

    const logger = {error: log, info: message => messages.push(message)};

    // Blocks confirm the deposit and then the fallback HTLC
    const mining = setInterval(() => {
      return alice.generate({}).catch(log);
    },
    miningIntervalMs);

    try {
      // The swap is never paid, it stops waiting at the HTLC timeout
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

      await sendToChainAddress({
        tokens,
        address: shown.swap.send_to_address,
        lnd: alice.lnd,
      });

      // Wait for the recovery that is shown before the fallback is signed
      const shownRecovery = await Promise.race([
        swap,
        asyncRetry({interval, times}, async () => {
          const message = messages.find(n => !!n.swap_recovery);

          if (!message) {
            throw new Error('WaitingForSwapRecoveryToBeShown');
          }

          return message;
        }),
      ]);

      const secret = shownRecovery.swap_recovery.recovery_secret;

      const recovery = decodeSwapInRecovery({recovery: secret});

      // The service moves the deposit to the fallback HTLC instead of paying
      const htlcKey = await getPublicKey({
        family: sharedAddressKeyFamily,
        index: recovery.htlc_index,
        lnd: alice.lnd,
      });

      const {script} = swapScriptV2({
        claim_public_key: recovery.htlc_service_public_key,
        hash: recovery.htlc_hash,
        refund_public_key: htlcKey.public_key,
        timeout: recovery.htlc_timeout,
      });

      const htlc = addressForScript({network, script});

      await asyncRetry({interval, times}, async () => {
        const {utxos} = await getSharedUtxos({
          network,
          address: htlc.address,
          lnd: alice.lnd,
          min_height: recovery.htlc_start_height,
        });

        if (!utxos.find(n => !!n.confirmation_height)) {
          throw new Error('WaitingForFallbackHtlcToConfirm');
        }
      });

      ok(!messages.find(n => !!n.swap_funds_received), 'Swap is not paid');

      const refundAddress = await createChainAddress({lnd: alice.lnd});

      // The fallback HTLC funds cannot be refunded before the HTLC times out
      await rejects(
        swapIn({
          fetch,
          tokens,
          lnd: alice.lnd,
          logger: {error: log, info: log},
          max_fee: maxFee,
          recovery: secret,
          refund_address: refundAddress.address,
          socket: swapServer.socket,
        }),
        ([, message, details]) => {
          const heights = details.refund_heights;

          return message === notRefundableError &&
            heights.includes(recovery.htlc_timeout);
        },
        'Refund before the fallback HTLC times out reports the refund height'
      );

      // Mine to the timeout height of the fallback HTLC
      const start = await getHeight({lnd: alice.lnd});

      await alice.generate({
        count: recovery.htlc_timeout - start.current_block_height,
      });

      // Wait for the node to sync to the timeout of the fallback HTLC
      await asyncRetry({interval, times}, async () => {
        const chain = await getHeight({lnd: alice.lnd});

        if (chain.current_block_height < recovery.htlc_timeout) {
          throw new Error('WaitingForNodeToSyncToFallbackHtlcTimeout');
        }
      });

      // The swap stops waiting for the payment once the fallback times out
      await rejects(swap, notPaid, 'Unpaid swap stops at the HTLC timeout');

      // The invoice of the unpaid swap is canceled so it cannot be paid
      const {invoices} = await getInvoices({lnd: alice.lnd});

      const invoice = invoices.find(n => n.description.startsWith('Swap in'));

      ok(!!invoice && !!invoice.is_canceled, 'Swap invoice is canceled');

      const refundMessages = [];

      // The swap funds are refunded from the timed out fallback HTLC
      await swapIn({
        fetch,
        tokens,
        lnd: alice.lnd,
        logger: {error: log, info: message => refundMessages.push(message)},
        max_fee: maxFee,
        recovery: secret,
        refund_address: refundAddress.address,
        socket: swapServer.socket,
      });

      const refund = refundMessages.find(n => !!n.swap_refund_transaction_id);

      ok(!!refund, 'Swap that is not paid is refunded');

      await alice.generate({});

      const refunded = await asyncRetry({interval, times}, async () => {
        const {transactions} = await getChainTransactions({lnd: alice.lnd});

        const id = refund.swap_refund_transaction_id;

        const tx = transactions.find(n => n.id === id);

        if (!tx || !tx.is_confirmed) {
          throw new Error('WaitingForRefundToConfirm');
        }

        return tx;
      });

      const isPaid = refunded.output_addresses.includes(refundAddress.address);

      ok(isPaid, 'Refund pays the fallback HTLC funds to the refund address');

      // Nothing is left in the fallback HTLC
      const {utxos} = await getSharedUtxos({
        network,
        address: htlc.address,
        lnd: alice.lnd,
        min_height: recovery.htlc_start_height,
      });

      ok(!utxos.length, 'Fallback HTLC funds are refunded');
    } finally {
      clearInterval(mining);

      swapServer.kill({});
    }
  } finally {
    await kill({});
  }
});
