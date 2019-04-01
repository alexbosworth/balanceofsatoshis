const {OP_CHECKSEQUENCEVERIFY} = require('bitcoin-ops');
const {OP_CHECKSIG} = require('bitcoin-ops');
const {OP_DROP} = require('bitcoin-ops');
const {OP_ELSE} = require('bitcoin-ops');
const {OP_ENDIF} = require('bitcoin-ops');
const {OP_IF} = require('bitcoin-ops');
const {script} = require('bitcoinjs-lib');

const {publicKeyByteLength} = require('./constants');

const {decompile} = script;

const toLocalOutput = [
  OP_IF,
    // Penalty transaction
    'public_key',
  OP_ELSE,
    'csv_delay',
    OP_CHECKSEQUENCEVERIFY,
    OP_DROP,
    'public_key',
  OP_ENDIF,
  OP_CHECKSIG,
];

/** Determine if a decompiled script is an offered htlc output script

  {
    program: <Witness Program Hex String>
  }

  @returns
  <Is Offered Htlc Script Bool>
*/
module.exports = ({program}) => {
  const script = decompile(Buffer.from(program, 'hex'));

  if (script.length !== toLocalOutput.length) {
    return false;
  }

  const invalidElement = script.find((element, i) => {
    if (toLocalOutput[i] === element) {
      return false;
    }

    if (!Buffer.isBuffer(element)) {
      return true;
    }

    switch (toLocalOutput[i]) {
    case 'csv_delay':
      return false;

    case 'public_key':
      return element.length !== publicKeyByteLength;

    default:
      return true;
    }
  });

  return !invalidElement;
};
