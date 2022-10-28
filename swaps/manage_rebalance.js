const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {returnResult} = require('asyncjs-util');

const rebalance = require('./rebalance');

const {isArray} = Array;

/** Manage rebalance attempts

  {
    [avoid]: [<Avoid Forwarding Through Node With Public Key Hex String>]
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    [in_filters]: [<Inbound Filter Formula String>]
    [in_outbound]: <Inbound Target Outbound Liquidity Tokens Number>
    [in_through]: <Pay In Through Peer String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [max_fee]: <Maximum Fee Tokens Number>
    [max_fee_rate]: <Max Fee Rate Tokens Per Million Number>
    [max_rebalance]: <Maximum Amount to Rebalance Tokens String>
    [node]: <Node Name String>
    [out_filters]: [<Outbound Filter Formula String>]
    [out_inbound]: <Outbound Target Inbound Liquidity Tokens Number>
    [out_through]: <Pay Out Through Peer String>
    [strict_max_fee]: < Strict Maximum Fee Tokens Number>
    [timeout_minutes]: <Deadline To Stop Rebalance Minutes Number>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.fs) {
          return cbk([400, 'ExpectedFsToManageRebalance']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToManageRebalance'])
        }

        if (isArray(args.max_fee)) {
          return cbk([400, 'ExpectedSingleMaxFeeValue']);
        }

        if (isArray(args.max_fee_rate)) {
          return cbk([400, 'ExpectedSingleMaxFeeValue']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToManageRebalance']);
        }

        if (isArray(args.strict_max_fee)) {
          return cbk([400, 'ExpectedSingleStrictMaxFeeValue']);
        }

        return cbk();
      },

      // Run the rebalance
      rebalance: ['validate', ({}, cbk) => {
        return asyncRetry({
          errorFilter: err => {
            // Do not retry on invalid errors
            if (!isArray(err)) {
              return false;
            }

            const [code, type] = err;

            // Do not retry on client errors
            if (code >= 400 && code < 500) {
              return false;
            }

            // Do not retry on timeout errors
            if (code === 503 && type === 'ProbeTimeout') {
              return false;
            }

            args.logger.error({err});

            return true;
          },
        },
        cbk => {
          return rebalance({
            avoid: args.avoid,
            fs: args.fs,
            in_filters: args.in_filters,
            in_outbound: args.in_outbound,
            in_through: args.in_through,
            lnd: args.lnd,
            logger: args.logger,
            max_fee: Number(args.max_fee) || undefined,
            max_fee_rate: Number(args.max_fee_rate) || undefined,
            max_rebalance: args.max_rebalance,
            out_filters: args.out_filters,
            out_inbound: args.out_inbound,
            out_through: args.out_through,
            strict_max_fee: Number(args.strict_max_fee) || undefined,
            timeout_minutes: args.timeout_minutes,
          },
          cbk);
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'rebalance'}, cbk));
  });
};
