const asyncAuto = require('async/auto');
const {lightningLabsSwapService} = require('goldengate');
const {returnResult} = require('asyncjs-util');

const {authenticatedLnd} = require('./../lnd');
const {getNetwork} = require('./../network');

/** Get swap service

  {
    [node]: <Node Name String>
  }

  @returns via cbk or Promise
  {
    service: <Swap Service Object>
  }
*/
module.exports = ({node}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Get LND
      getLnd: cbk => authenticatedLnd({node}, cbk),

      // LND object
      lnd: ['getLnd', ({getLnd}, cbk) => cbk(null, getLnd.lnd)],

      // Get network
      getNetwork: ['lnd', ({lnd}, cbk) => getNetwork({lnd}, cbk)],

      // Swap service
      service: ['getNetwork', ({getNetwork}, cbk) => {
        const {network} = getNetwork;

        try {
          return cbk(null, lightningLabsSwapService({network}));
        } catch (err) {
          return cbk([400, 'FailedToFindSupportedSwapService', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'service'}));
  });
};
