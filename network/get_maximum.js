const asyncAuto = require('async/auto');
const asyncWhilst = require('async/whilst');
const {returnResult} = require('asyncjs-util');

/** Get maximum value

  {
    [accuracy]: <Close Enough Delta Number>
    from: <Minimum Number>
    to: <Maximum Number>
  }

  <Async Test Function> ({cursor}, (err, isLow) => {}) => {}

  @returns via cbk
  {
    maximum: <Maximum Number>
  }
*/
module.exports = ({accuracy, from, to}, test, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (from === undefined) {
          return cbk([400, 'ExpectedLowerValueToGetMaximum']);
        }

        if (!test) {
          return cbk([400, 'ExpectedTestFunctionToGetMaximumValue']);
        }

        if (to === undefined) {
          return cbk([400, 'ExpectedUpperValueToGetMaximum']);
        }

        if (from > to) {
          return cbk([400, 'ExpectedLowValueLowerThanUpperValueToGetMaximum']);
        }

        return cbk();
      },

      // Search
      search: ['validate', ({}, cbk) => {
        let cursor;
        let successes = 0;
        let lowerBound = from;
        let upperBound = to;

        return asyncWhilst(
          cbk => cbk(null, lowerBound < upperBound - (accuracy || 0)),
          cbk => {
            // Set the cursor to the midpoint of the range
            cursor = (lowerBound + upperBound) >>> 1;

            // Find out where the cursor lies in the range
            return test({cursor}, (err, isLow) => {
              if (!!err) {
                return cbk(err);
              }

              // Exit early and increase the lower bound when guess is too low
              if (isLow) {
                lowerBound = cursor + 1;
                successes = successes + 1;

                return cbk();
              }

              upperBound = cursor - 1;

              return cbk();
            });
          },
          err => {
            if (!!err) {
              return cbk(err);
            }

            // Exit early with no result when no guess was too low
            if (!successes) {
              return cbk(null, {});
            }

            cbk(null, {maximum: lowerBound})
          }
        );
      }],
    },
    returnResult({reject, resolve, of: 'search'}, cbk));
  });
};
