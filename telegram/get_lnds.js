const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {returnResult} = require('asyncjs-util');
const {getWalletInfo} = require('ln-service');

const {getLnds} = require('./../lnd');

const fromName = node => `${node.alias} ${node.public_key.substring(0, 8)}`;
const {isArray} = Array;
const sanitize = n => (n || '').replace(/_/g, '\\_').replace(/[*~`]/g, '');

/** Get Lnds for telegram commands

  {
    nodes: [<Saved Nodes String>]
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
  {
    lnds: [<LND Object>]
    alias: [<Node Alias String>]
    from: [<Node Name String>]
    public_key: [<Node Public Key Hex String>]

  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.nodes)) {
          return cbk([400, 'ExpectedArrayOfSavedNodesToRunTelegramBot']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToRunTelegramBot']);
        }

        return cbk();
      },

      // Get associated LNDs
      getLnds: ['validate', ({}, cbk) => {
        return getLnds({logger: args.logger, nodes: args.nodes}, cbk);
      }],

      // Get node info
      getNodes: ['getLnds', ({getLnds}, cbk) => {
        return asyncMap(getLnds.lnds, (lnd, cbk) => {
          return getWalletInfo({lnd}, (err, res) => {
            if (!!err) {
              return cbk([503, 'FailedToGetNodeInfo', {err}]);
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
    },
    returnResult({reject, resolve, of: 'getNodes'}, cbk));
  });
}