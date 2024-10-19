const asyncAuto = require('async/auto');
const asyncFilter = require('async/filter');
const {getChannel} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const channelForEdge = edge => edge.slice(0, -2);
const codeMissingChannel = 404;
const detokenize = tokens => tokens.join(' ');
const isEdge = n => !!n && /^\d*x\d*x\d*x[01]$/.test(n);
const setAsArray = set => Array.from(set);
const tokenize = command => command.split(' ');

/** Clean a command of non-relevant data

  {
    command: <Command String>
    lnd: <Authenticated LND API String>
  }

  @returns via cbk or Promise
  {
    cleaned: <Cleaned Command String>
  }
*/
module.exports = ({command, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!command) {
          return cbk([400, 'ExpectedNonEmptyCommandToCleanCommand']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToCleanCommand']);
        }

        return cbk();
      },

      // Tokenize the command string
      tokens: ['validate', ({}, cbk) => cbk(null, tokenize(command))],

      // Collect lookup channel ids
      channels: ['tokens', ({tokens}, cbk) => {
        const edges = new Set();

        // Look for elements to lookup
        tokens.forEach((token, i) => {
          const next = tokens[i + 1];

          // Avoid edges can be evaluated for removal based on missing channels
          if (token === '--avoid' && isEdge(next)) {
            edges.add(channelForEdge(next));
          }

          return;
        });

        return cbk(null, {ids: setAsArray(edges)});
      }],

      // Determine which channel ids reference missing channels
      getMissing: ['channels', ({channels}, cbk) => {
        return asyncFilter(channels.ids, (id, cbk) => {
          return getChannel({lnd, id}, err => {
            const [code] = err || [];

            return cbk(null, code === codeMissingChannel);
          });
        },
        cbk);
      }],

      // Revised command with no invalid references
      revised: ['getMissing', 'tokens', ({getMissing, tokens}, cbk) => {
        const skips = new Set();

        tokens.forEach((token, i) => {
          const next = tokens[i + 1];

          // Exit early when not an avoid edge
          if (token !== '--avoid' || !isEdge(next)) {
            return;
          }

          // Exit early when avoid edge channel is still present
          if (!getMissing.includes(channelForEdge(next))) {
            return;
          }

          // Mark the avoid edge where channel is missing as a skip
          skips.add(i);
          skips.add(i + 1);

          return;
        });

        return cbk(null, detokenize(tokens.filter((_, i) => !skips.has(i))));
      }],
    },
    returnResult({reject, resolve, of: 'revised'}, cbk));
  });
};
