const {chains} = require('./networks');
const {currencySymbols} = require('./networks');

const {isArray} = Array;
const {keys} = Object;
const reversedBytes = hex => Buffer.from(hex, 'hex').reverse().toString('hex');

/** Currency for network

  {
    chains: [<Chain Id Hex String>]
  }

  @throws
  <Error>

  @returns
  {
    currency: <Currency String>
  }
*/
module.exports = args => {
  if (!isArray(args.chains)) {
    throw new Error('ExpectedArrayOfChainsToDetermineCurrencyForNetwork');
  }

  const [chain, otherChain] = args.chains;

  if (!!otherChain) {
    throw new Error('CannotDetermineCurrencyForMultipleChains');
  }

  const network = keys(chains).find(network => {
    return chain === reversedBytes(chains[network]);
  });

  if (!network) {
    throw new Error('UnknownChainForCurrency');
  }

  return {currency: currencySymbols[network]};
};
