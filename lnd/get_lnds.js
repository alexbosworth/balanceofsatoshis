const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {returnResult} = require('asyncjs-util');

const authenticatedLnd = require('./authenticated_lnd');

const flatten = arr => [].concat(...arr);

/** Get LNDs for specified nodes

  {
    [logger]: <Winston Logger Object>
    [nodes]: <Node Name String> || [<Node Name String>]
  }

  @return via cbk or Promise
  {
    lnds: [<Authenticated LND API Object>]
  }
*/
module.exports = ({logger, nodes}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Default lnd
      getLnd: cbk => {
        if (!!nodes) {
          return cbk();
        }

        return authenticatedLnd({logger}, cbk);
      },

      // Authenticated LND Objects
      getLnds: cbk => {
        if (!nodes) {
          return cbk();
        }

        return asyncMap(flatten([nodes].filter(n => !!n)), (node, cbk) => {
          return authenticatedLnd({logger, node}, cbk);
        },
        cbk);
      },

      // Final lnds
      lnds: ['getLnd', 'getLnds', ({getLnd, getLnds}, cbk) => {
        if (!nodes) {
          return cbk(null, {lnds: [getLnd.lnd]});
        }

        return cbk(null, {lnds: getLnds.map(n => n.lnd)});
      }],
    },
    returnResult({reject, resolve, of: 'lnds'}, cbk));
  });
};
