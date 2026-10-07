const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {returnResult} = require('asyncjs-util');

const {getIcons} = require('./../display');
const getNodePending = require('./get_node_pending');
const pendingSummary = require('./pending_summary');

const {isArray} = Array;

/** Get a summary of pending channels and in-flight HTLCs

  When there are multiple nodes, pending items are grouped by node

  {
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    [is_monochrome]: <Mute Colors Bool>
    lnds: [<Authenticated LND API Object>]
    logger: <Winston Logger Object>
    [max_relays]: <Maximum Relaying Peers of a Path to Show Number>
  }

  @returns via cbk or Promise
  <Pending Items Summary String>
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.fs) {
          return cbk([400, 'ExpectedFileSystemMethodsToGetPendingItems']);
        }

        if (!isArray(args.lnds)) {
          return cbk([400, 'ExpectedArrayOfLndsToGetPendingItems']);
        }

        if (!args.lnds.length) {
          return cbk([400, 'ExpectedAnLndToGetPendingItems']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToGetPendingItems']);
        }

        if (args.max_relays !== undefined && args.max_relays < 0) {
          return cbk([400, 'ExpectedNonNegativeMaxRelaysCountToShow']);
        }

        return cbk();
      },

      // Get the tag icons for nodes
      getIcons: ['validate', ({}, cbk) => getIcons({fs: args.fs}, cbk)],

      // Get the pending items for every node
      getNodes: ['validate', ({}, cbk) => {
        return asyncMap(args.lnds, (lnd, cbk) => {
          return getNodePending({lnd, logger: args.logger}, cbk);
        },
        cbk);
      }],

      // Summarize the pending items
      summary: ['getIcons', 'getNodes', ({getIcons, getNodes}, cbk) => {
        const {summary} = pendingSummary({
          is_monochrome: args.is_monochrome,
          max_relays: args.max_relays,
          nodes: getNodes,
          tagged: getIcons.nodes,
        });

        return cbk(null, summary);
      }],
    },
    returnResult({reject, resolve, of: 'summary'}, cbk));
  });
};
