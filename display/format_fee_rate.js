const asDisplay = rate => `${(rate / 1e4).toFixed(2)}% (${rate})`;
const asPercent = rate => `${(rate / 1e4).toFixed()}%`;
const highRate = 5e6;

/** Format fee rate for display

  {
    [rate]: <Fee Rate Parts Per Million Number>
  }

  @returns
  {
    display: <Display Formatted Rate String>
  }
*/
module.exports = ({rate}) => {
  if (rate === undefined) {
    return {display: String()};
  }

  if (rate > highRate) {
    return {display: asPercent(rate)};
  }

  return {display: asDisplay(rate)};
};
