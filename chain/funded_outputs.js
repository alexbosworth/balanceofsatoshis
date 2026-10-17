const splitFee = require('./split_fee');

const minimumOutputCount = 1;

/** Count the split outputs that selected inputs can fund to reach a count

  Every counted utxo that is spent has to be replaced by a new utxo

  {
    counted: <Spending Counted UTXOs Count Number>
    inputs: <Spending Inputs Count Number>
    needed: <Needed Additional UTXOs Count Number>
    rate: <Fee Tokens Per Virtual Byte Number>
    size: <Split Output Tokens Number>
    tokens: <Spending Inputs Tokens Number>
    vbytes: <Spending Inputs Virtual Bytes Number>
  }

  @returns
  {
    [outputs]: <Split Outputs Count Number>
  }
*/
module.exports = args => {
  const outputs = args.needed + args.counted;

  // When the change is large enough it can be one of the new utxos
  const withChange = outputs - minimumOutputCount;

  const changeFee = splitFee({
    has_change: true,
    inputs: args.inputs,
    outputs: withChange,
    rate: args.rate,
    vbytes: args.vbytes,
  });

  const change = args.tokens - (withChange * args.size) - changeFee;

  // Exit early when the change will be large enough to count as a new utxo
  if (withChange >= minimumOutputCount && change >= args.size) {
    return {outputs: withChange};
  }

  const fee = splitFee({
    outputs,
    inputs: args.inputs,
    rate: args.rate,
    vbytes: args.vbytes,
  });

  // Exit early when the inputs cannot pay for all of the outputs
  if (args.tokens < (outputs * args.size) + fee) {
    return {};
  }

  return {outputs};
};
