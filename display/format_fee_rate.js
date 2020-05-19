const asDisplay = rate => `${(rate / 1e4).toFixed(2)}% (${rate})`;

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

  return {display: asDisplay(rate)};
};
