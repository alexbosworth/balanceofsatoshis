const asyncAuto = require('async/auto');
const {evaluateFormula} = require('@alexbosworth/formulas');
const {returnResult} = require('asyncjs-util');

const pairEdgeIndex = (pair, key) => `x${Number(!pair.indexOf(key))}`;

/** Append failing edge based on formula match

  {
    avoid: <Formula For Edge To Avoid String>
    failure: {
      index: <Failure Hop Index Number>
      reason: <Failure Reason String>
      route: [{
        hops: [{
          channel: <Standard Format Channel Id String>
          public_key: <Node Public Key Hex String>
        }]
      }]
    }
    fs: {
      appendFile: <Append to File Function> (path, content, cbk) => {}
    }
    list: <File Path To Avoid List String>
  }

  @returns via cbk
  {
    edge: <Appended Failing Edge Id String>
  }
*/
module.exports = ({avoid, failure, fs, list}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!avoid) {
          return cbk([400, 'ExpectedAvoidanceFormulaToAppendFailingEdge']);
        }

        if (!failure) {
          return cbk([400, 'ExpectedFailureDetailsToAppendFailingEdge']);
        }

        if (!fs) {
          return cbk([400, 'ExpectedFilesystemMethodsToAppendFailingEdge']);
        }

        if (!list) {
          return cbk([400, 'ExpectedPathToAvoidListToAppendFailingEdge']);
        }

        return cbk();
      },

      // Derive the set of edges
      edges: ['validate', ({}, cbk) => {
        return cbk(null, failure.route.hops.map((hop, i, hops) => {
          const pair = [(hops[i - 1] || {}).public_key, hop.public_key].sort();

          return `${hop.channel}${pairEdgeIndex(pair, hop.public_key)}`;
        }));
      }],

      // Determine if there is a formula matching edge
      failing: ['edges', ({edges}, cbk) => {
        const edge = edges[failure.index];

        try {
          const {result} = evaluateFormula({
            constants: {
              FAILURE_INDEX: failure.index,
              FAILURE_REASON: failure.reason,
              ROUTE_HOPS_COUNT: failure.route.hops.length,
            },
            formula: avoid,
          });

          // Exit early when there is no append edge formula match
          if (!result) {
            return cbk(null, {});
          }

          return cbk(null, {edge});
        } catch (err) {
          return cbk([400, 'ExpectedValidAppendEdgeFormula', err.message]);
        }
      }],

      // Append the failing edge to the avoid list
      append: ['failing', ({failing}, cbk) => {
        // Exit early when there is no relevant failing edge to append
        if (!failing.edge) {
          return cbk();
        }

        return fs.appendFile(list, `\n${failing.edge}`, err => {
          if (!!err) {
            return cbk([500, 'UnexpectedErrorAppendingFailEdge', err.message]);
          }

          return cbk()
        });
      }],
    },
    returnResult({reject, resolve, of: 'failing'}, cbk));
  });
};
