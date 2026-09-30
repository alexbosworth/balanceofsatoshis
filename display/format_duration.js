const {durationUnits} = require('./constants');

const {floor} = Math;
const maxUnits = 2;
const plural = (count, unit) => `${count} ${unit}${count === 1 ? '' : 's'}`;

/** Format a duration for display, using the two largest units of time

  {
    ms: <Duration Milliseconds Number>
  }

  @returns
  {
    display: <Display Formatted Duration String>
  }
*/
module.exports = ({ms}) => {
  // Take whole counts of each unit out of the duration, largest unit first
  const {parts, remaining} = durationUnits.reduce((sum, unit) => {
    const count = floor(sum.remaining / unit.ms);

    return {
      parts: !count ? sum.parts : sum.parts.concat(plural(count, unit.unit)),
      remaining: sum.remaining - count * unit.ms,
    };
  },
  {parts: [], remaining: ms});

  // Leftover milliseconds are shown when present or when there is nothing else
  const leftover = !remaining && !!parts.length ? [] : [`${remaining} ms`];

  return {display: parts.concat(leftover).slice(0, maxUnits).join(' ')};
};
