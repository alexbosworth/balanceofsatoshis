const {scriptAsScriptElements} = require('@alexbosworth/blockchain');

const bufferAsHex = buffer => buffer.toString('hex');
const fundingScriptElementsCount = 5;
const {isBuffer} = Buffer;
const OP_2 = 82;
const OP_CHECKMULTISIG = 174;
const publicKeyByteLength = 33;

/** Derive the funding public keys from the witness of the funding output spend

  A close transaction spends the funding output with a 2 of 2 multisig witness
  script that commits to both funding public keys.

  {
    [witness]: [<Witness Stack Element Hex String>]
  }

  @returns
  {
    [keys]: [<Funding Public Key Hex String>]
  }
*/
module.exports = ({witness}) => {
  // Exit early when there is no witness script to look at
  if (!witness || !witness.length) {
    return {};
  }

  const [script] = [].concat(witness).reverse();

  // Witness elements are always hex, a malformed script has no elements
  const {elements} = scriptAsScriptElements({script});

  // Exit early when the script is not shaped like a 2 of 2 multisig
  if (!elements || elements.length !== fundingScriptElementsCount) {
    return {};
  }

  const [op2, key1, key2, op2Again, opCheckMultisig] = elements;

  // Exit early when the script is not a 2 of 2 multisig
  if (op2 !== OP_2 || op2Again !== OP_2) {
    return {};
  }

  if (opCheckMultisig !== OP_CHECKMULTISIG) {
    return {};
  }

  const keys = [key1, key2];

  // Exit early when the keys are not public keys
  if (!!keys.find(n => !isBuffer(n) || n.length !== publicKeyByteLength)) {
    return {};
  }

  return {keys: keys.map(bufferAsHex)};
};
