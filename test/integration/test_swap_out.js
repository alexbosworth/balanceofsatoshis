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
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {createInvoice} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getInvoices} = require('ln-service');
const {getMasterPublicKeys} = require('ln-service');
const {pay} = require('ln-service');
const {setupChannel} = require('ln-docker-daemons');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {quoteSwapOut} = require('./../macros');
const {spawnSwapServer} = require('./../macros');
const {swapOut} = require('./../../swaps');

const capacity = 1e6;
const confs = 1;
const interval = 1000;
const keySpendWitnessLength = 1;
const log = () => {};
const maturity = 100;
const maxFee = 1e5;
const maxSweepFee = 2e4;
const miningIntervalMs = 2000;
const outFilters = ['OUTBOUND_LIQUIDITY > 0'];
const probeTokens = 1;
const size = 2;
const taprootDerivationPath = `m/86'/0'/0'`;
const times = 300;
const tokens = 250000;

// Swapping out should get on-chain funds from a swap server
test(`Swap out through a swap server`, async () => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [alice, swapNode] = nodes;

  try {
    const {keys} = await getMasterPublicKeys({lnd: alice.lnd});

    // Exit early when taproot is not supported
    if (!keys.find(n => n.derivation_path === taprootDerivationPath)) {
      return;
    }

    // Alice pays for the swap through a channel with the swap server node
    await setupChannel({
      capacity,
      generate: alice.generate,
      lnd: alice.lnd,
      to: swapNode,
    });

    // Wait for the channel to be usable to pay the swap server node
    await asyncRetry({interval, times}, async () => {
      const {request} = await createInvoice({
        lnd: swapNode.lnd,
        tokens: probeTokens,
      });

      await pay({request, lnd: alice.lnd});
    });

    // The swap server node funds the swap on chain with mined coins
    await swapNode.generate({count: maturity});

    const swapServer = await spawnSwapServer({
      lnd: swapNode.lnd,
      logger: {error: log, info: log},
    });

    const messages = [];

    const logger = {error: log, info: message => messages.push(message)};

    // Blocks confirm the swap funding and then the sweep of the swap
    const mining = setInterval(() => {
      return alice.generate({}).catch(log);
    },
    miningIntervalMs);

    try {
      await swapOut({
        confs,
        fetch,
        logger,
        tokens,
        avoid: [],
        fs: {getFile: (path, cbk) => cbk()},
        lnd: alice.lnd,
        max_fee: maxFee,
        out_filters: outFilters,
        peer: swapNode.id,
        socket: swapServer.socket,
      });
    } finally {
      clearInterval(mining);

      swapServer.kill({});
    }

    ok(!!messages.find(n => !!n.total_fee_paid), 'Swap out is summarized');

    // The swap server took the deposit and the funding payments of the swap
    const {deposit, fee} = quoteSwapOut({tokens, public_key: swapNode.id});

    const {invoices} = await getInvoices({lnd: swapNode.lnd});

    const paid = invoices.filter(n => !!n.is_confirmed).map(n => n.tokens);

    ok(paid.includes(deposit), 'Swap deposit is taken by the swap server');
    ok(paid.includes(tokens + fee - deposit), 'Swap funding is taken');

    // The swap was swept to the wallet, less the chain fee of the sweep
    const {transactions} = await getChainTransactions({lnd: alice.lnd});

    const sweep = transactions.find(transaction => {
      // Exit early when the transaction is not a receive of the swap amount
      if (!!transaction.is_outgoing || transaction.tokens > tokens) {
        return false;
      }

      return transaction.tokens > tokens - maxSweepFee;
    });

    ok(!!sweep && !!sweep.is_confirmed, 'Swap is swept to the wallet');

    // The cooperative sweep spends with a key
    const [input] = componentsOfTransaction({
      transaction: sweep.transaction,
    }).inputs;

    const isKeySpend = input.witness.length === keySpendWitnessLength;

    ok(isKeySpend, 'Swap is swept with a key spend');
  } finally {
    await kill({});
  }
});
