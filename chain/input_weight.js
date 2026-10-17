const {numberAsCompactInt} = require('@alexbosworth/blockchain');

const byteCountOutpoint = 36;
const byteCountSequence = 4;
const compactIntSize = n => numberAsCompactInt({number: n}).encoded.length;
const hexByteLength = hex => hex.length / 2;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const witnessScaling = 4;

/** Calculate the weight contributed by a transaction input

  {
    script: <ScriptSig Script Hex String>
    [witness]: [<Script Stack Element Hex String>]
  }

  @returns
  <Input Weight Units Number>
*/
module.exports = ({script, witness}) => {
  const scriptBytes = hexByteLength(script);

  const base = [
    byteCountOutpoint,
    compactIntSize(scriptBytes),
    scriptBytes,
    byteCountSequence,
  ];

  // Non-witness bytes count four times as much as witness bytes
  const baseWeight = sumOf(base) * witnessScaling;

  // Exit early when there is no witness data for the input
  if (!witness) {
    return baseWeight;
  }

  const items = witness.map(n => {
    return compactIntSize(hexByteLength(n)) + hexByteLength(n);
  });

  return baseWeight + compactIntSize(witness.length) + sumOf(items);
};
