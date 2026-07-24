const {evaluateFormula} = require('@alexbosworth/formulas');

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
      key: <Label Prefixed Node Key String>
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

  const rates = args.node_rates.reduce((sum, n) => {
    sum[n.key] = n.rate;

    return sum;
  },
  {});

  try {
    const {result} = evaluateFormula({
      constants: {
        ...rates,
        inbound: args.inbound_liquidity,
        inbound_fee_rate: args.inbound_fee_rate,
        outbound: args.outbound_liquidity,
      },
      formula: args.fee_rate,
      functions: {
        bips: bipsAsPpm,
        percent: percentAsPpm,
      },
    });

    return {rate: ceil(result)};
  } catch (err) {
    return {failure: err.message};
  }
};
