const {Parser} = require('hot-formula-parser');

const {ceil} = Math;
const {isArray} = Array;
const {keys} = Object;
const {round} = Math;

/** Parse a described amount into tokens

  {
    amount: <Amount String>
    [variables]: {
      <Name String>: <Amount Number>
    }
  }

  @throws
  <Error>

  @returns
  {
    tokens: <Tokens Number>
  }
*/
module.exports = ({amount, variables}) => {
  if (isArray(amount)) {
    throw new Error('CannotParseMultipleAmounts');
  }

  const parser = new Parser();

  keys(variables || {}).forEach(key => {
    parser.setVariable(key.toLowerCase(), variables[key]);
    parser.setVariable(key.toUpperCase(), variables[key]);

    return;
  });

  parser.setVariable('BTC', 1e8);
  parser.setVariable('btc', 1e8);
  parser.setVariable('m', 1e6);
  parser.setVariable('M', 1e6);
  parser.setVariable('mm', 1e6);
  parser.setVariable('MM', 1e6);
  parser.setVariable('k', 1e3);
  parser.setVariable('K', 1e3);

  const parsed = parser.parse(amount);

  switch (parsed.error) {
  case '#DIV/0!':
    throw new Error('CannotDivideByZeroInSpecifiedAmount');

  case '#ERROR!':
    throw new Error('FailedToParseSpecifiedAmount');

  case '#N/A':
  case '#NAME?':
    throw new Error('UnrecognizedVariableOrFunctionInSpecifiedAmount');

  case '#NUM!':
    throw new Error('InvalidNumberFoundInSpecifiedAmount');

  case '#VALUE!':
    throw new Error('UnexpectedValueTypeInSpecifiedAmount');

  default:
    break;
  }

  if (!!parsed.error) {
    throw new Error(parsed.error);
  }

  return {tokens: round(parsed.result)};
};
