const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {returnResult} = require('asyncjs-util');

const interval = n => 50 * Math.pow(2, n);
const isNumber = n => !isNaN(n);
const times = 10;

/** Get mempool size

  {
    network: <Network Name String>
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    [vbytes]: <Size of Mempool Virtual Bytes Number>
  }
*/
module.exports = ({network, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!network) {
          return cbk([400, 'ExpectedNetworkNameToGetMempoolSize']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestMethodToGetMempoolSize']);
        }

        return cbk();
      },

      // API for network
      api: ['validate', ({}, cbk) => {
        switch (network) {
        case 'btc':
          return cbk(null, 'https://blockstream.info');

        case 'btctestnet':
          return cbk(null, 'https://blockstream.info/testnet');

        default:
          return cbk();
        }
      }],

      // Get mempool size
      getMempool: ['api', ({api}, cbk) => {
        if (!api) {
          return cbk(null, {});
        }

        return asyncRetry({interval, times}, cbk => {
          return request({
            json: true,
            url: `${api}/api/mempool`,
          },
          (err, r, mempool) => {
            if (!!err) {
              return cbk([503, 'FailedToGetMempoolSizeInfo', {err}]);
            }

            if (!mempool) {
              return cbk([503, 'ExpectedMempoolInfoInResponse']);
            }

            if (!isNumber(mempool.vsize)) {
              return cbk([503, 'ExpectedMempoolVirtualByteSize']);
            }

            return cbk(null, {vbytes: mempool.vsize});
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'getMempool'}, cbk));
  });
};
