const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {returnResult} = require('asyncjs-util');
const {getWalletInfo} = require('ln-service');

const {getLnds} = require('./../lnd');

const fromName = node => `${node.alias} ${node.public_key.substring(0, 8)}`;
const {isArray} = Array;
const sanitize = n => (n || '').replace(/_/g, '\\_').replace(/[*~`]/g, '');

/** Get node details for telegram commands

  {
    logger: <Winston Logger Object>
    nodes: [<Saved Node Name String>]
  }

  @returns via cbk or Promise
  {
    nodes: [{
      lnd: <Authenticated LND API Object>
      alias: <Node Alias String>
      from: <Node Name String>
      public_key: <Node Identity Public Key Hex String>
    }]
  }
*/
module.exports = ({logger, nodes}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerGetGetTelegramNodeDetails']);
        }

        if (!isArray(nodes)) {
          return cbk([400, 'ExpectedArrayOfSavedNodesToGetNodeDetailsFor']);
        }

        return cbk();
      },

      // Get associated LNDs
      getLnds: ['validate', ({}, cbk) => getLnds({logger, nodes}, cbk)],

      // Get node info for the nodes
      getNodes: ['getLnds', ({getLnds}, cbk) => {
        return asyncMap(getLnds.lnds, (lnd, cbk) => {
          return getWalletInfo({lnd}, (err, res) => {
            if (!!err) {
              return cbk([503, 'FailedToGetNodeInfoForTelegramNode', {err}]);
            }

            const named = fromName({
              alias: res.alias,
              public_key: res.public_key,
            });

            return cbk(null, {
              lnd,
              alias: res.alias,
              from: sanitize(named),
              public_key: res.public_key,
            });
          });
        },
        cbk);
      }],

      // List of nodes with details
      nodes: ['getNodes', ({getNodes}, cbk) => cbk(null, {nodes: getNodes})],
    },
    returnResult({reject, resolve, of: 'nodes'}, cbk));
  });
};
