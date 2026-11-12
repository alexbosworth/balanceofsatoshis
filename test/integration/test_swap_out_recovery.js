const {fork} = require('node:child_process');
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
const {getChainTransactions} = require('ln-service');
const {getInvoices} = require('ln-service');
const {getMasterPublicKeys} = require('ln-service');
const {pay} = require('ln-service');
const {setupChannel} = require('ln-docker-daemons');

const {quoteSwapOut} = require('./../macros');
const {spawnSwapNodes} = require('./../macros');
const {spawnSwapServer} = require('./../macros');
const {swapOut} = require('./../../swaps');

const capacity = 1e6;
const confs = 1;
const interval = 1000;
const isWaiting = err => err.message === 'WaitingForSwapToBeInterrupted';
const log = () => {};
const maturity = 100;
const maxFee = 1e5;
const maxSweepFee = 2e4;
const miningIntervalMs = 2000;
const neverStarted = [404, 'SwapNeverStartedSwapPaymentsNotMade'];
const probeTokens = 1;
const runSwapOut = join(__dirname, '..', 'macros', 'run_swap_out.js');
const taprootDerivationPath = `m/86'/0'/0'`;
const times = 300;
const tokens = 250000;

// Recovering a swap out should finish a swap that was interrupted
test(`Recover an interrupted swap out`, async () => {
  const {client, kill, server} = await spawnSwapNodes({});

  try {
    const {keys} = await getMasterPublicKeys({lnd: client.lnd});

    // Exit early when taproot is not supported
    if (!keys.find(n => n.derivation_path === taprootDerivationPath)) {
      return;
    }

    // The client pays for the swap through a channel with the swap server
    await setupChannel({
      capacity,
      generate: client.generate,
      lnd: client.lnd,
      to: server,
    });

    // Wait for the channel to be usable to pay the swap server node
    await asyncRetry({interval, times}, async () => {
      const {request} = await createInvoice({
        lnd: server.lnd,
        tokens: probeTokens,
      });

      await pay({request, lnd: client.lnd});
    });

    // The swap server node funds the swap on chain with mined coins
    await server.generate({count: maturity});

    const swapServer = await spawnSwapServer({
      lnd: server.lnd,
      logger: {error: log, info: log},
    });

    // Blocks confirm the swap funding and then the sweep of the swap
    const mining = setInterval(() => {
      return client.generate({}).catch(log);
    },
    miningIntervalMs);

    try {
      // Run a swap in a child process and kill it when it logs a message key
      const interrupt = async ({at}) => {
        const messages = [];
        const state = {};

        const swap = fork(runSwapOut, [JSON.stringify({
          confs,
          tokens,
          cert: client.cert,
          macaroon: client.macaroon,
          max_fee: maxFee,
          socket: client.rpc_socket,
          swap_socket: swapServer.socket,
        })]);

        swap.once('exit', () => state.is_exited = true);

        swap.on('message', message => {
          messages.push(message);

          // Interrupt the swap as soon as it reports reaching the point
          if (message[at] !== undefined) {
            swap.kill('SIGKILL');
          }
        });

        // Wait for the swap to be interrupted after logging a restart code
        const restart = await asyncRetry({
          interval,
          times,
          errorFilter: isWaiting,
        },
        async () => {
          const failure = messages.find(n => !!n.error);

          if (!!failure) {
            throw new Error(`SwapFailed: ${JSON.stringify(failure.error)}`);
          }

          const message = messages.find(n => !!n.restart_recovery_secret);

          if (!message || !state.is_exited) {
            throw new Error('WaitingForSwapToBeInterrupted');
          }

          return message.restart_recovery_secret;
        });

        ok(!messages.find(n => !!n.total_fee_paid), 'Swap was interrupted');

        return restart;
      };

      // Recover a swap with a restart code and collect the swap messages
      const recover = async ({restart}) => {
        const messages = [];

        await swapOut({
          confs,
          fetch,
          avoid: [],
          fs: {getFile: (path, cbk) => cbk()},
          lnd: client.lnd,
          logger: {error: log, info: message => messages.push(message)},
          max_fee: maxFee,
          recovery: restart,
          socket: swapServer.socket,
        });

        return messages;
      };

      // A swap interrupted before it paid for the swap never started
      const unstarted = await interrupt({at: 'restart_recovery_secret'});

      await rejects(recover({restart: unstarted}), neverStarted, 'Unstarted');

      // A swap interrupted after its HTLC confirmed is finished by recovery
      const restart = await interrupt({at: 'confirm_height'});

      const recovered = await recover({restart});

      ok(!!recovered.find(n => !!n.total_fee_paid), 'Recovery is summarized');
    } finally {
      clearInterval(mining);

      swapServer.kill({});
    }

    // The swap server took the deposit and the funding payments of the swap
    const {deposit, fee} = quoteSwapOut({tokens, public_key: server.id});

    const {invoices} = await getInvoices({lnd: server.lnd});

    const paid = invoices.filter(n => !!n.is_confirmed).map(n => n.tokens);

    ok(paid.includes(deposit), 'Swap deposit is taken by the swap server');
    ok(paid.includes(tokens + fee - deposit), 'Swap funding is taken');

    // The swap was swept to the wallet, less the chain fee of the sweep
    const {transactions} = await getChainTransactions({lnd: client.lnd});

    const sweep = transactions.find(transaction => {
      // Exit early when the transaction is not a receive of the swap amount
      if (!!transaction.is_outgoing || transaction.tokens > tokens) {
        return false;
      }

      return transaction.tokens > tokens - maxSweepFee;
    });

    ok(!!sweep && !!sweep.is_confirmed, 'Swap is swept to the wallet');
  } finally {
    await kill({});
  }
});
