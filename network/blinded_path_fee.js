const feeRateDenominator = BigInt(1e6);
const {isArray} = Array;
const isMtokens = n => typeof n === 'string' && /^\d+$/.test(n);
const isNumber = n => typeof n === 'number' && !isNaN(n);
const noFee = '0';

/** Calculate the fee to deliver an amount through a blinded path

  {
    mtokens: <Millitokens To Deliver To The Destination String>
    path: {
      base_fee_mtokens: <Accumulated Base Fee Millitokens String>
      fee_rate: <Accumulated Fee Rate Millitokens Per Million Number>
      hops: [{
        encrypted_data: <Encrypted Recipient Data Hex String>
        relay_key: <Relaying Node Public Key Hex String>
      }]
    }
  }

  @throws
  <Error>

  @returns
  {
    fee_mtokens: <Blinded Path Fee Millitokens String>
  }
*/
module.exports = ({mtokens, path}) => {
  if (!isMtokens(mtokens)) {
    throw new Error('ExpectedMillitokensToCalculateBlindedPathFee');
  }

  if (!path) {
    throw new Error('ExpectedBlindedPathToCalculateBlindedPathFee');
  }

  if (!isMtokens(path.base_fee_mtokens)) {
    throw new Error('ExpectedBaseFeeMillitokensToCalculateBlindedPathFee');
  }

  if (!isNumber(path.fee_rate)) {
    throw new Error('ExpectedFeeRateToCalculateBlindedPathFee');
  }

  if (!isArray(path.hops) || !path.hops.length) {
    throw new Error('ExpectedPathHopsToCalculateBlindedPathFee');
  }

  // Exit early when the path is just the destination, there is no relaying
  if (path.hops.length === [path].length) {
    return {fee_mtokens: noFee};
  }

  const baseFee = BigInt(path.base_fee_mtokens);
  const proportional = BigInt(mtokens) * BigInt(path.fee_rate);

  const fee = baseFee + proportional / feeRateDenominator;

  return {fee_mtokens: fee.toString()};
};
