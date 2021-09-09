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
    [in_outbound]: <Inbound Target Outbound Liquidity Tokens Number>
    [in_through]: <Pay In Through Peer String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [max_fee]: <Maximum Fee Tokens Number>
    [max_fee_rate]: <Max Fee Rate Tokens Per Million Number>
    [max_rebalance]: <Maximum Amount to Rebalance Tokens String>
    [node]: <Node Name String>
    [out_channels]: [<Exclusively Rebalance Through Channel Ids String>]
    [out_inbound]: <Outbound Target Inbound Liquidity Tokens Number>
    [out_through]: <Pay Out Through Peer String>
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

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToManageRebalance']);
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
            in_outbound: args.in_outbound,
            in_through: args.in_through,
            lnd: args.lnd,
            logger: args.logger,
            max_fee: args.max_fee,
            max_fee_rate: args.max_fee_rate,
            max_rebalance: args.max_rebalance,
            out_channels: args.out_channels,
            out_inbound: args.out_inbound,
            out_through: args.out_through,
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
