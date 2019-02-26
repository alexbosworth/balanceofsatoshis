const noTokens = 0;

/** Get balance from tokens

  {
    [above]: <Tokens Above Tokens Number>
    [below]: <Tokens Below Tokens Number>
    tokens: [<Tokens Number>]
  }

  @throws
  <Error>

  @returns
  <Balance Number>
*/
module.exports = args => {
  if (!Array.isArray(args.tokens)) {
    throw new Error('ExpectedTokensToCalculateBalance');
  }

  const total = args.tokens.reduce((sum, n) => n + sum, noTokens);

  if (!!args.above) {
    return total > args.above ? total - args.above : noTokens;
  }

  if (!!args.below) {
    return total < args.below ? args.below - total : noTokens;
  }

  return total;
};
