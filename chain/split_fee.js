const baseTxVbytes = 9;
const changeOutputVbytes = 43;
const {ceil} = Math;
const compactVbytes = 1;
const countVbytes = n => n <= maxCompactCount ? compactVbytes : wideVbytes;
const maxCompactCount = 252;
const splitOutputVbytes = 31;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const wideVbytes = 3;

/** Fee for a split transaction, rounding up so that the fee is not too low

  Virtual sizes are upper bounds of the sizes the wallet estimates with

  {
    [has_change]: <Transaction Has a Change Output Bool>
    inputs: <Inputs Count Number>
    outputs: <Split Outputs Count Number>
    rate: <Fee Tokens Per Virtual Byte Number>
    vbytes: <Inputs Virtual Bytes Number>
  }

  @returns
  <Fee Tokens Number>
*/
module.exports = args => {
  const changeVbytes = !!args.has_change ? changeOutputVbytes : Number();
  const outputsCount = args.outputs + Number(!!args.has_change);

  const vbytes = sumOf([
    baseTxVbytes,
    changeVbytes,
    countVbytes(args.inputs),
    countVbytes(outputsCount),
    args.outputs * splitOutputVbytes,
    args.vbytes,
  ]);

  return ceil(vbytes * args.rate);
};
