const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {returnResult} = require('asyncjs-util');

const {endpoints} = require('./blockstream');
const getRawTransaction = require('./get_raw_transaction');

const defaultInterval = n => 50 * Math.pow(2, n);
const {isArray} = Array;
const isHash = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const isHex = n => !!n && !(n.length % 2) && /^[0-9A-F]*$/i.test(n);

/** Get raw transaction hex

  {
    address: <Address String>
    [interval]: <Retry Interval Milliseconds Number>
    network: <Network Name String>
    request: <Request Function>
    [retries]: <Retries Count Number>
    tokens: <Tokens Number>
  }

  @returns via cbk or Promise
  {
    [transaction]: <Transaction Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.address) {
          return cbk([400, 'ExpectedAddressToGetUtxoFor']);
        }

        if (!args.network) {
          return cbk([400, 'ExpectedNetworkNameToGetUtxoForAddress']);
        }

        if (!endpoints[args.network]) {
          return cbk([400, 'UnsupportedNetworkToGetUtxoForAddress']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestMethodToGetUtxoForAddress']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedTokensToGetUtxoForAddress']);
        }

        return cbk();
      },

      // Get the UTXO transaction id
      getTransactionId: ['validate', ({}, cbk) => {
        return asyncRetry({
          interval: args.interval || defaultInterval,
          times: args.retries,
        },
        cbk => {
          return args.request({
            json: true,
            url: `${endpoints[args.network]}address/${args.address}/utxo`,
          },
          (err, r, utxos) => {
            if (!!err) {
              return cbk([503, 'FailedToGetAddressUtxos', {err}]);
            }

            if (!isArray(utxos)) {
              return cbk([503, 'ExpectedArrayOfUtxosInAddressUtxosResponse']);
            }

            const [utxo] = utxos.filter(n => n.value === args.tokens);

            // Exit early when there is no UTXO for the address
            if (!utxo) {
              return cbk();
            }

            if (!isHash(utxo.txid)) {
              return cbk([503, 'ExpectedTransactionIdInUtxoForAddress']);
            }

            return cbk(null, utxo.txid);
          });
        },
        cbk);
      }],

      // Get the raw transaction
      getTransaction: ['getTransactionId', ({getTransactionId}, cbk) => {
        // Exit early when there is no UTXO
        if (!getTransactionId) {
          return cbk(null, {});
        }

        return getRawTransaction({
          id: getTransactionId,
          interval: args.interval,
          network: args.network,
          request: args.request,
          retries: args.retries,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'getTransaction'}, cbk));
  });
};
