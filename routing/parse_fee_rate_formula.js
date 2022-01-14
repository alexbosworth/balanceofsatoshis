const {Parser} = require('hot-formula-parser');

const bipsAsPpm = bips => bips * 1e2;
const {ceil} = Math;
const percentAsPpm = percent => percent * 1e4;

/** Parse a fee rate formula

  {
    [fee_rate]: <PPM Fee Rate String>
    inbound_fee_rate: <Inbound PPM Fee Rate Number>
    inbound_liquidity: <Inbound Tokens Number>
    outbound_liquidity: <Outbound Tokens Number>
    node_rates: [{
      key: <Node Key String>
      rate: <Node PPM Rate Number>
    }]
  }

  @returns
  {
    [failure]: <Failure to Parse String>
    [rate]: <PPM Fee Rate Number>
  }
*/
module.exports = args => {
  if (args.fee_rate === undefined) {
    return {};
  }

  const parser = new Parser();

  parser.setFunction('BIPS', params => bipsAsPpm(params.slice().pop()));
  parser.setFunction('PERCENT', params => percentAsPpm(params.slice().pop()));
  parser.setVariable('INBOUND', args.inbound_liquidity);
  parser.setVariable('INBOUND_FEE_RATE', args.inbound_fee_rate);
  parser.setVariable('OUTBOUND', args.outbound_liquidity);

  args.node_rates.forEach(({key, rate}) => parser.setVariable(key, rate));

  const parsedRate = parser.parse(args.fee_rate.toUpperCase());

  switch (parsedRate.error) {
  case null:
    break;

  case '#DIV/0!':
    return {failure: 'FeeRateCalculationCannotDivideByZeroFormula'};

  case '#ERROR!':
    return {failure: 'FailedToParseFeeRateFormula'};

  default:
    return {failure: 'UnrecognizedVariableOrFunctionInFeeRateFormula'};
  }

  return {rate: ceil(parsedRate.result)};
};
