const asyncAuto = require('async/auto');
const {broadcastChainTransaction} = require('ln-service');
const {pay} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const buildSwapInSweep = require('./build_swap_in_sweep');
const finishSharedSessions = require('./finish_shared_sessions');
const {swapInMaxPaymentFeeTokens} = require('./../constants');
const {swapInSweepRetryMs} = require('./../constants');
const {swapInSweepWaitMs} = require('./../constants');

const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const locktime = 0;
const outpoint = n => `${n.transaction_id}:${n.transaction_vout}`;
const reversed = buffer => Buffer.from(buffer).reverse();
const version = 2;

/** Settle a swap in that has its fallback HTLCs signed

  {
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    network: <Network Name String>
    notify: <Notify Client Function> (notification) => {}
    swap: <Swap In Object>
  }

  @returns via cbk or Promise
  {
    transaction_id: <Sweep Transaction Id Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToSettleSwapIn']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToSettleSwapIn']);
        }

        if (!args.network) {
          return cbk([400, 'ExpectedNetworkNameToSettleSwapIn']);
        }

        if (!args.notify) {
          return cbk([400, 'ExpectedNotifyFunctionToSettleSwapIn']);
        }

        if (!args.swap) {
          return cbk([400, 'ExpectedSwapToSettleSwapIn']);
        }

        return cbk();
      },

      // Tell the client that the deposits are accepted
      accept: ['validate', ({}, cbk) => {
        const swapHash = hexAsBuffer(args.swap.hash);

        args.notify({static_loop_in_risk_accepted: {swap_hash: swapHash}});

        return cbk();
      }],

      // Pay the swap invoice
      pay: ['accept', ({}, cbk) => {
        return pay({
          incoming_peer: args.swap.incoming_peer,
          lnd: args.lnd,
          max_fee: swapInMaxPaymentFeeTokens,
          request: args.swap.request,
        },
        err => {
          if (!!err) {
            return cbk([503, 'FailedToPaySwapInInvoice', {err}]);
          }

          args.swap.is_paid = true;

          args.logger.info({paid_swap_in: args.swap.hash});

          return cbk();
        });
      }],

      // Build the sweep of the deposits
      build: ['pay', ({}, cbk) => {
        return buildSwapInSweep({
          lnd: args.lnd,
          network: args.network,
          swap: args.swap,
        },
        cbk);
      }],

      // Ask the client to cosign the sweep until the client cosigns it
      cosign: ['build', ({build}, cbk) => {
        const {emitter} = args.swap;

        const nonces = args.swap.deposits.reduce((sum, deposit, i) => {
          sum[outpoint(deposit)] = hexAsBuffer(build.sessions[i].nonce);

          return sum;
        },
        {});

        const notification = {
          static_loop_in_sweep: {
            deposit_to_nonces: nonces,
            prevout_info: build.prevouts.map(prevout => ({
              output_index: prevout.transaction_vout,
              pk_script: hexAsBuffer(prevout.script),
              txid_bytes: reversed(hexAsBuffer(prevout.transaction_id)),
              value: prevout.tokens.toString(),
            })),
            swap_hash: hexAsBuffer(args.swap.hash),
            sweep_tx_psbt: hexAsBuffer(build.psbt),
          },
        };

        const timeout = setTimeout(() => {
          return finished([503, 'TimedOutWaitingForSweepCosigning']);
        },
        swapInSweepWaitMs);

        const finished = (err, res) => {
          clearTimeout(timeout);

          emitter.removeAllListeners();

          return cbk(err, res);
        };

        // The client defers cosigning until it sees the swap payment
        emitter.on('deferred', () => {
          args.logger.info({sweep_cosigning_deferred: args.swap.hash});

          return setTimeout(() => {
            return args.notify(notification);
          },
          swapInSweepRetryMs);
        });

        emitter.on('signed', signatures => finished(null, signatures));

        args.swap.sweep = {id: build.id};

        args.notify(notification);

        return;
      }],

      // Finish the signing sessions with the client signatures
      sign: ['build', 'cosign', ({build, cosign}, cbk) => {
        const inputs = args.swap.deposits.map((deposit, i) => {
          const signed = cosign[outpoint(deposit)] || {};

          return {
            hash: build.hashes[i],
            id: build.sessions[i].id,
            nonce: signed.nonce,
            signature: signed.signature,
          };
        });

        if (inputs.some(n => !n.nonce || !n.signature)) {
          return cbk([400, 'ExpectedClientSignatureForEveryDeposit']);
        }

        return finishSharedSessions({inputs, lnd: args.lnd}, cbk);
      }],

      // Publish the sweep
      publish: ['build', 'sign', ({build, sign}, cbk) => {
        const {transaction} = transactionFromComponents({
          locktime,
          version,
          inputs: build.inputs.map((input, i) => ({
            id: input.id,
            script: input.script,
            sequence: input.sequence,
            vout: input.vout,
            witness: [sign.signatures[i]],
          })),
          outputs: build.outputs,
        });

        return broadcastChainTransaction({transaction, lnd: args.lnd}, cbk);
      }],

      // Swept deposits
      swept: ['publish', ({publish}, cbk) => {
        args.swap.is_swept = true;

        args.logger.info({swept_swap_in_deposits: publish.id});

        return cbk(null, {transaction_id: publish.id});
      }],
    },
    returnResult({reject, resolve, of: 'swept'}, cbk));
  });
};
