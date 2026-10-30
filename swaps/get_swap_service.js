const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const {getNetwork} = require('ln-sync');
const {lightningLabsSwapService} = require('goldengate');
const {returnResult} = require('asyncjs-util');

const {authenticatedLnd} = require('./../lnd');

/** Get swap service

  {
    [logger]: <Winston Logger Object>
    [node]: <Node Name String>
  }

  @returns via cbk or Promise
  {
    service: <Swap Service Object>
  }
*/
module.exports = ({logger, node}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Get LND
      getLnd: cbk => authenticatedLnd({logger, node}, cbk),

      // LND object
      lnd: ['getLnd', ({getLnd}, cbk) => cbk(null, getLnd.lnd)],

      // Get network
      getNetwork: ['lnd', ({lnd}, cbk) => getNetwork({lnd}, cbk)],

      // Swap service
      service: ['getNetwork', asyncify(({getNetwork}) => {
        const {network} = getNetwork;

        try {
          return lightningLabsSwapService({network});
        } catch (err) {
          throw [400, 'FailedToFindSupportedSwapService', {err}];
        }
      })],
    },
    returnResult({reject, resolve, of: 'service'}));
  });
};
