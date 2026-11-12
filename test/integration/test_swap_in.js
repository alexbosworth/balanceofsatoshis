const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const {join} = require('node:path');
const {ok} = require('node:assert').strict;
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
const {getHeight} = require('ln-service');
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
const {quoteSwapIn} = require('./../macros');
const {sharedAddressKeyFamily} = require('./../../swaps/constants');
const {spawnSwapServer} = require('./../macros');
const {swapIn} = require('./../../swaps');

const capacity = 1e6;
const depositsCount = 1;
const feeRate = 2;
const giftTokens = 1e5;
const interval = 1000;
const {isArray} = Array;
const isNoted = n => n.deposit_not_swapped !== undefined;
const isWaiting = n => n.waiting_for_deposit_confirmations !== undefined;
const {keys} = Object;
const log = () => {};
const maturity = 100;
const maxFee = 5000;
const miningIntervalMs = 2000;
const network = 'btcregtest';
const probeTokens = 1;
const refundTokens = 120000;
const size = 2;
const swapsCount = 2;
const taprootDerivationPath = `m/86'/0'/0'`;
const times = 300;
const tokens = 250000;
const withdrawTokens = 150000;

// Values in progress messages that change from run to run
const varying = {
  completed: '<date>',
  recovery_secret: '<recovery secret>',
  refund_if_unpaid: '<refund height>',
  send_to_address: '<shared address>',
  service_api_key: '<api key>',
  send_to_qr: '<qr code>',
  swap_id: '<swap id>',
};

// Replace the varying values in a message with their descriptions
const stable = message => keys(message).reduce((sum, key) => {
  const value = message[key];

  if (!!varying[key]) {
    sum[key] = varying[key];
  } else if (!!value && typeof value === 'object' && !isArray(value)) {
    sum[key] = stable(value);
  } else {
    sum[key] = value;
  }

  return sum;
},
{});

// What the user sees during a swap in, apart from waiting for confirmations
const expectedProgress = [
  {
    amount_paid_for_api_key: '0.00000001',
    service_api_key: '<api key>',
  },
  {
    swap: {
      send_to_address: '<shared address>',
      send_exact_amount: '0.00250000',
      send_to_qr: '<qr code>',
    },
    estimated_swap_fee: '0.00001350',
    estimated_swap_fee_rate: '0.54% (5400)',
    recovery_secret: '<recovery secret>',
    timing: {refund_available: '500 blocks after deposit'},
  },
  {
    swap_recovery: {
      recovery_secret: '<recovery secret>',
      refund_if_unpaid: '<refund height>',
    },
  },
  {swap_id: '<swap id>'},
  {
    swap_funds_received: '0.00248650',
    keep_running: 'Cooperative signing reduces blockchain space use',
  },
  {cosigning_sweeps: 'Waiting for cooperative signing request'},
  {
    swap_successful: {
      completed: '<date>',
      received_offchain: '0.00248650',
      swap_fee_paid: '0.00001350',
      swap_fee_rate: '0.54% (5400)',
    },
  },
];

// Swapping in should pay off-chain for deposits to a shared address
test(`Swap in through a shared address`, async () => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [alice, server] = nodes;

  try {
    const {keys} = await getMasterPublicKeys({lnd: alice.lnd});

    // Exit early when taproot is not supported
    if (!keys.find(n => n.derivation_path === taprootDerivationPath)) {
      return;
    }

    // The swap server node pays Alice for her deposits through a channel and
    // Alice pays the swap server node for its API token with gifted tokens
    await setupChannel({
      capacity,
      generate: server.generate,
      give_tokens: giftTokens,
      lnd: server.lnd,
      to: alice,
    });

    // Wait for the channel to be usable to pay in both directions
    await asyncRetry({interval, times}, async () => {
      const toAlice = await createInvoice({
        lnd: alice.lnd,
        tokens: probeTokens,
      });

      await pay({lnd: server.lnd, request: toAlice.request});

      const toServer = await createInvoice({
        lnd: server.lnd,
        tokens: probeTokens,
      });

      await pay({lnd: alice.lnd, request: toServer.request});
    });

    // Alice deposits mined coins
    await alice.generate({count: maturity});

    const swapServer = await spawnSwapServer({
      lnd: server.lnd,
      logger: {error: log, info: log},
    });

    const messages = [];

    const logger = {error: log, info: message => messages.push(message)};

    // Blocks confirm the deposits and then the sweep of the deposits
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

      const recovery = decodeSwapInRecovery({recovery: shown.recovery_secret});

      // A deposit of a different amount is not swapped in
      await sendToChainAddress({
        address,
        lnd: alice.lnd,
        tokens: withdrawTokens,
      });

      // Wait for the different amount deposit to confirm, or the swap to fail
      await Promise.race([
        swap,
        asyncRetry({interval, times}, async () => {
          const {utxos} = await getSharedUtxos({
            address,
            network,
            lnd: alice.lnd,
            min_height: recovery.start_height,
          });

          if (!utxos.find(n => n.tokens === withdrawTokens)) {
            throw new Error('WaitingForOtherAmountDepositToConfirm');
          }
        }),
      ]);

      // A deposit of the exact amount is swapped in
      await sendToChainAddress({address, tokens, lnd: alice.lnd});

      await swap;

      // The swap paid Alice the deposit less the service fee
      const {fee} = quoteSwapIn({tokens, utxos_count: depositsCount});

      const {invoices} = await getInvoices({lnd: alice.lnd});

      const paid = invoices.filter(n => !!n.is_confirmed).map(n => n.received);

      ok(paid.includes(tokens - fee), 'Swap in is paid');
      ok(!!messages.find(n => !!n.swap_funds_received), 'Funds reported');

      // The swap reported its progress in order, apart from deposit notices
      const progress = messages.filter(n => !isWaiting(n) && !isNoted(n));

      deepEqual(progress.map(stable), expectedProgress, 'Swap in progress');

      // Depending on block timing the deposit of another amount is noted
      const notes = messages.filter(isNoted).map(n => n.deposit_not_swapped);

      const otherAmount = (withdrawTokens / 1e8).toFixed(8);

      ok(notes.every(n => n.amount === otherAmount), 'Other deposit noted');

      // The recovery secret shown before signing the fallback has its HTLC
      const shownRecovery = messages.find(n => !!n.swap_recovery);

      const swapRecovery = decodeSwapInRecovery({
        recovery: shownRecovery.swap_recovery.recovery_secret,
      });

      ok(!!swapRecovery.htlc_hash, 'Swap recovery can refund the fallback');

      // Wait for the service to sweep the swapped deposit
      await asyncRetry({interval, times}, async () => {
        const {utxos} = await getSharedUtxos({
          address,
          network,
          lnd: alice.lnd,
          min_height: recovery.start_height,
        });

        if (!!utxos.find(n => n.tokens === tokens)) {
          throw new Error('WaitingForSwappedDepositToBeSpent');
        }
      });

      // The recovery secret swaps in another deposit to the shared address
      const againMessages = [];

      const again = swapIn({
        fetch,
        tokens,
        lnd: alice.lnd,
        logger: {error: log, info: message => againMessages.push(message)},
        max_fee: maxFee,
        recovery: shown.recovery_secret,
        socket: swapServer.socket,
      });

      // Wait for the shared address to be shown again, or the swap to fail
      const reshown = await Promise.race([
        again,
        asyncRetry({interval, times}, async () => {
          const message = againMessages.find(n => !!n.swap);

          if (!message) {
            throw new Error('WaitingForSharedAddressToBeShownAgain');
          }

          return message;
        }),
      ]);

      equal(reshown.swap.send_to_address, address, 'Recovery reuses address');

      await sendToChainAddress({address, tokens, lnd: alice.lnd});

      await again;

      ok(!!againMessages.find(n => !!n.swap_successful), 'Swapped in again');

      const paidAgain = await getInvoices({lnd: alice.lnd});

      const paidSwaps = paidAgain.invoices.filter(invoice => {
        return !!invoice.is_confirmed && invoice.received === tokens - fee;
      });

      equal(paidSwaps.length, swapsCount, 'Both swaps in are paid');

      // The ignored deposit is left at the shared address
      const deposits = await asyncRetry({interval, times}, async () => {
        const {utxos} = await getSharedUtxos({
          address,
          network,
          lnd: alice.lnd,
          min_height: recovery.start_height,
        });

        if (!!utxos.find(n => n.tokens === tokens)) {
          throw new Error('WaitingForSwappedDepositToBeSpent');
        }

        return utxos;
      });

      deepEqual(deposits.map(n => n.tokens), [withdrawTokens], 'Deposit left');

      // The ignored deposit is withdrawn cooperatively with the service
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
        expiry: recovery.expiry,
        fee_tokens_per_vbyte: feeRate,
        key_family: sharedAddressKeyFamily,
        key_index: recovery.index,
        lnd: alice.lnd,
        service_public_key: recovery.service_public_key,
        sweep_address: sweepAddress.address,
        utxos: deposits,
      });

      await broadcastChainTransaction({
        lnd: alice.lnd,
        transaction: withdraw.transaction,
      });

      await alice.generate({});

      const withdrawn = await asyncRetry({interval, times}, async () => {
        const {transactions} = await getChainTransactions({lnd: alice.lnd});

        const tx = transactions.find(n => n.id === withdraw.id);

        if (!tx || !tx.is_confirmed) {
          throw new Error('WaitingForWithdrawToConfirm');
        }

        return tx;
      });

      ok(!!withdrawn, 'Deposit is withdrawn with the service');

      // An expired deposit is refunded without the service
      await sendToChainAddress({
        address,
        lnd: alice.lnd,
        tokens: refundTokens,
      });

      const expiring = await asyncRetry({interval, times}, async () => {
        const {utxos} = await getSharedUtxos({
          address,
          network,
          lnd: alice.lnd,
          min_height: recovery.start_height,
        });

        const utxo = utxos.find(n => n.tokens === refundTokens);

        if (!utxo || !utxo.confirmation_height) {
          throw new Error('WaitingForDepositToRefundToConfirm');
        }

        return utxo;
      });

      const refundHeight = expiring.confirmation_height + recovery.expiry;

      await alice.generate({count: recovery.expiry});

      // Wait for the node to sync to the blocks that expire the deposit
      await asyncRetry({interval, times}, async () => {
        const chain = await getHeight({lnd: alice.lnd});

        if (chain.current_block_height < refundHeight) {
          throw new Error('WaitingForNodeToSyncToDepositExpiry');
        }
      });

      const refundAddress = await createChainAddress({lnd: alice.lnd});

      const refundMessages = [];

      await swapIn({
        fetch,
        tokens,
        lnd: alice.lnd,
        logger: {error: log, info: message => refundMessages.push(message)},
        max_fee: maxFee,
        recovery: shown.recovery_secret,
        refund_address: refundAddress.address,
        socket: swapServer.socket,
      });

      const refund = refundMessages.find(n => !!n.refund_transaction_id);

      ok(!!refund, 'Expired deposit is refunded');

      await alice.generate({});

      await asyncRetry({interval, times}, async () => {
        const {transactions} = await getChainTransactions({lnd: alice.lnd});

        const id = refund.refund_transaction_id;

        const tx = transactions.find(n => n.id === id);

        if (!tx || !tx.is_confirmed) {
          throw new Error('WaitingForRefundToConfirm');
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
