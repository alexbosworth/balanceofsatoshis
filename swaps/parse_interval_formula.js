const {evaluateFormula} = require('@alexbosworth/formulas');

const maxIntervalMs = 2147483647;
const minIntervalMs = 0;
const msPerDay = 24 * 60 * 60 * 1e3;
const msPerHour = 60 * 60 * 1e3;
const msPerMinute = 60 * 1e3;
const msPerSecond = 1e3;
const msPerWeek = 7 * 24 * 60 * 60 * 1e3;
const {round} = Math;

/** Parse a time interval formula into milliseconds

  Variables: s/second(s), min/minute(s), h/hour(s), d/day(s), w/week(s)

  FAILURES_COUNT is the count of failed attempts in a row, when counted

  {
    [failures]: <Failed Attempts In A Row Count Number>
    formula: <Interval Formula String>
  }

  @returns
  {
    [failure]: <Failure to Parse String>
    [ms]: <Interval Milliseconds Number>
  }
*/
module.exports = ({failures, formula}) => {
  if (typeof formula !== 'string') {
    return {failure: 'ExpectedIntervalFormulaStringToParse'};
  }

  // FAILURES_COUNT is only a known variable when failures are being counted
  const counted = failures === undefined ? {} : {failures_count: failures};

  try {
    const {result} = evaluateFormula({
      formula,
      constants: {
        ...counted,
        d: msPerDay,
        day: msPerDay,
        days: msPerDay,
        h: msPerHour,
        hour: msPerHour,
        hours: msPerHour,
        min: msPerMinute,
        minute: msPerMinute,
        minutes: msPerMinute,
        s: msPerSecond,
        second: msPerSecond,
        seconds: msPerSecond,
        w: msPerWeek,
        week: msPerWeek,
        weeks: msPerWeek,
      },
    });

    if (result < minIntervalMs) {
      return {failure: 'ExpectedNonNegativeIntervalFromFormula'};
    }

    if (result > maxIntervalMs) {
      return {failure: 'ExpectedIntervalWithinMaximumTimerDelay'};
    }

    return {ms: round(result)};
  } catch (err) {
    return {failure: err.message};
  }
};
