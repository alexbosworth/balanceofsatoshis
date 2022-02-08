const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const lnd = require('./../lnd');

const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const isString = n => typeof n === 'string';
const openingNodes = n => flatten([n]);


/** Get a list of opening saved nodes

  {
    default_node: <Default Node Name String || undefined>
    logger: <Winston Logger Object>
    opening_nodes: <Opening Nodes Array>
  }

  @returns via cbk or Promise
  {
    lnds: [Array of authenticated lnd objects]
  }
*/
module.exports = ({default_node, logger, opening_nodes}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      //Check Arguments
      validate: cbk => { 
        if (!isString(default_node) && default_node !== undefined) {
          return cbk([400, 'ExpectedDefaultNodeNameToGetOpeningNodeLnds']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToGetOpeningNodeLnds']);
        }
        
        if (!isArray(opening_nodes)) {
          return cbk([400, 'ExpectedArrayOfOpeningNodesToGetOpeningNodeLnds']);
        }

        return cbk();
      },

      //Get Lnds
      getLnds: ['validate', async ({}) => {
        try {
          const nodes = !!opening_nodes.length ? openingNodes(opening_nodes).map(String) : [];
          //Exit early if there are no opening nodes
          if (!nodes.length) {
            return nodes;
          }

          //Get lnds of all opening nodes, 
          const lnds = await Promise.all(
            nodes.map(async node => { 
              return (await lnd.authenticatedLnd({
                logger,
                node: node !== 'true' ? node: default_node
              })).lnd
            }),
          );

        return lnds;
        } catch (err) {
          throw new Error(err);
        }
      }],

    },
    returnResult({reject, resolve, of: 'getLnds'}, cbk));
  });
};