const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {returnResult} = require('asyncjs-util');
const {Transaction} = require('bitcoinjs-lib');

const {endpoints} = require('./blockstream');

const defaultInterval = n => 50 * Math.pow(2, n);
const isHash = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const isHex = n => !!n && !(n.length % 2) && /^[0-9A-F]*$/i.test(n);

/** Get raw transaction hex

  {
    id: <Transaction Id Hex String>
    [interval]: <Retry Interval Milliseconds Number>
    network: <Network Name String>
    request: <Request Function>
    [retries]: <Retries Count Number>
  }

  @returns via cbk or Promise
  {
    transaction: <Transaction Hex String>
  }
*/
module.exports = ({id, interval, network, request, retries}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isHash(id)) {
          return cbk([400, 'ExpectedTransactionIdToGetRawTransaction']);
        }

        if (!network) {
          return cbk([400, 'ExpectedNetworkNameToGetRawTransaction']);
        }

        if (!endpoints[network]) {
          return cbk([400, 'UnsupportedNetworkToGetRawTransaction']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestMethodToGetRawTrasaction']);
        }

        return cbk();
      },

      // Get the raw transaction
      getTransaction: ['validate', ({}, cbk) => {
        return asyncRetry({
          interval: interval || defaultInterval,
          times: retries,
        },
        cbk => {
          return request({
            url: `${endpoints[network]}tx/${id}/hex`,
          },
          (err, r, transaction) => {
            if (!!err) {
              return cbk([503, 'FailedToGetRawTransaction', {err}]);
            }

            if (!!r && r.statusCode === 404) {
              return cbk([404, 'TransactionNotFound']);
            }

            if (!isHex(transaction)) {
              return cbk([503, 'ExpectedTransactionInResponse']);
            }

            try {
              Transaction.fromHex(transaction);
            } catch (err) {
              return cbk([503, 'ExpectedValidTransactionInResponse']);
            }

            return cbk(null, {transaction});
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'getTransaction'}, cbk));
  });
};
