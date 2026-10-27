const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const {decodeFirstSync} = require('cbor');

const {encodeAsCbor} = require('./../../encryption');

const hexAsBuffer = hex => Buffer.from(hex, 'hex');

// A value with an encoding larger than a stream buffer
const makeLargeValue = () => ({
  cert: Buffer.alloc(1e5, 1),
  payments: [...Array(1e4).keys()].map(n => ({n, memo: `memo ${n}`})),
});

const tests = [
  {
    args: {value: {a: 1}},
    description: 'A value is encoded as CBOR',
    expected: {value: {a: 1}},
  },
  {
    args: {value: makeLargeValue()},
    description: 'A value larger than a stream buffer is encoded in full',
    expected: {value: makeLargeValue()},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, (t, end) => {
    const {cbor} = encodeAsCbor(args);

    const decoded = decodeFirstSync(hexAsBuffer(cbor));

    deepEqual(decoded, expected.value, 'Got the value back from its encoding');

    return end();
  });
});
