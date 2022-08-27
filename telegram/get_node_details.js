const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {getLnds} = require('./../lnd');

const {isArray} = Array;

/** Get node details for telegram commands

  {
    logger: <Winston Logger Object>
    names: [{
      alias: <Node Alias String>
      from: <Node Name String>
      public_key: <Node Identity Public Key Hex String>
    }]
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
module.exports = ({logger, names, nodes}, cbk) => {
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

      // Merge node info for the nodes
      nodes: ['getLnds', ({getLnds}, cbk) => {
        const nodes = getLnds.lnds.map((lnd, i) => {
          return {
            lnd,
            alias: names[i].alias,
            from: names[i].from,
            public_key: names[i].public_key,
          };
        });

        return cbk(null, {nodes});
      }],
    },
    returnResult({reject, resolve, of: 'nodes'}, cbk));
  });
};
