const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const pay = require('./pay');
const withdraw = require('./withdraw');

/** Manage Lnurl Functions
 {
  ask: <Ask Function>
  avoid: [<Avoid Forwarding Through String>]
  request: <Request Function>
  lnd: <Authenticated LND API Object>
  lnurl: <Lnurl String>
  logger: <Winston Logger Object>
  max_fee: <Max Fee Tokens Number>
  max_paths: <Maximum Paths Number>
  out: [<Out Through Peer With Public Key Hex String>]
 }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToManageLnurl']);
        }

        if (!args.function) {
          return cbk([400, 'ExpectedLnurlFunctionToManageLnurl']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToManageLnurl']);
        }

        if (!args.lnurl) {
          return cbk([400, 'ExpectedUrlStringToManageLnurl']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToManageLnurl']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToManageLnurl']);
        }

        return cbk();
      },

      // Pay to lnurl
      pay: ['validate', ({}, cbk) => {
        // Exit early if not lnurl pay
        if (args.function !== 'pay') {
          return cbk();
        }
        return pay({
          ask: args.ask,
          avoid: args.avoid,
          lnd: args.lnd,
          lnurl: args.lnurl,
          logger: args.logger,
          max_fee: args.max_fee,
          max_paths: args.max_paths,
          out: args.out,
          request: args.request,
        },
        cbk);
      }],

      // Withdraw from lnurl
      withdraw: ['validate', ({}, cbk) => {
        // Exit early if not lnurl withdraw
        if (args.function !== 'withdraw') {
          return cbk();
        }
        return withdraw({
          ask: args.ask,
          lnd: args.lnd,
          lnurl: args.lnurl,
          logger: args.logger,
          request: args.request,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
