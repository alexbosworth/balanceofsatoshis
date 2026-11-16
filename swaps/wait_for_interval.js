const asyncAuto = require('async/auto');
const asyncUntil = require('async/until');
const {returnResult} = require('asyncjs-util');

const isInterval = n => Number.isSafeInteger(n) && n >= 0;
const {min} = Math;
const now = () => Date.now();
const stepMs = 1000;

/** Wait for an interval to elapse, including time that the computer sleeps

  {
    ms: <Interval Milliseconds Number>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isInterval(args.ms)) {
          return cbk([400, 'ExpectedIntervalMillisecondsToWaitFor']);
        }

        return cbk();
      },

      // Wait in short steps, since timers do not count time asleep
      wait: ['validate', ({}, cbk) => {
        const end = now() + args.ms;
        let waited = Number();

        return asyncUntil(
          // The wait is over when the clock or the timers reach the end
          cbk => cbk(null, now() >= end || waited >= args.ms),
          cbk => {
            const step = min(stepMs, args.ms - waited);

            waited += step;

            return setTimeout(cbk, step);
          },
          cbk
        );
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
