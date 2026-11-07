const {isFinite} = Number;
const {round} = Math;
const {sqrt} = Math;

/** Get the range of prices that the round dollar payments of a day point to

  {
    [dispersion]: <Peak Width Beyond Smoothing As Price Fraction Number>
    price: <Price String>
  }

  @returns
  {
    [range]: <Low Price to High Price String>
  }
*/
module.exports = ({dispersion, price}) => {
  // Exit early when there is no width to describe
  if (!isFinite(dispersion)) {
    return {};
  }

  // The peak reaches the square root of the dispersion factor either side
  const reach = sqrt(1 + dispersion);

  const high = round(Number(price) * reach);
  const low = round(Number(price) / reach);

  return {range: `${low} to ${high}`};
};
