const {createHash} = require('node:crypto');
const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../chain/anchor_output_script');

const key = `02${'11'.repeat(32)}`;
const sha256 = hex => createHash('sha256').update(hex, 'hex').digest('hex');

// <key> OP_CHECKSIG OP_IFDUP OP_NOTIF OP_16 OP_CSV OP_ENDIF
const anchorScript = `21${key}ac736460b268`;

const tests = [
  {
    args: {key},
    description: 'An anchor output pays to the key with a 16 block CSV escape',
    expected: {script: `0020${sha256(anchorScript)}`},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected anchor output script');

    return;
  });
});
