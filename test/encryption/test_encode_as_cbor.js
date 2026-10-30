const {deepEqual} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const {decodeCbor} = require('./../../encryption');
const {encodeAsCbor} = require('./../../encryption');

// Encodings made by the cbor package, so encodings stay the same as before
const credentials = 'a36463657274446365727472656e637279707465645f6d616361726f6f6e486d616361726f6f6e66736f636b65746a686f73743a3130303039';
const encrypted = 'a569656e637279707465644301010162697650020202020202020202020202020202026473616c74582003030303030303030303030303030303030303030303030303030303030303036873657474696e6773a669616c676f726974686d6b6165732d3235362d67636d6a64657269766174696f6e66736372797074666469676573746673686135313268656e636f64696e67f76a6b65795f6c656e6774681820647769746881f7637461675004040404040404040404040404040404';
const integers = '900017181818ff19010019ffff1a000100001affffffff1b00000001000000001b001fffffffffffff2037381838ff3901003a00010000';
const token = 'a2686d616361726f6f6e486d616361726f6f6e68707265696d61676558200505050505050505050505050505050505050505050505050505050505050505';

// A value with an encoding larger than a stream buffer
const largeValue = {
  cert: Buffer.alloc(1e5, 1),
  payments: Array(1e4).fill('memo'),
};

// The large value encodes as its cert bytes and then its repeated payments
const largeValueCbor = [
  'a2',
  '6463657274',
  `5a000186a0${'01'.repeat(1e5)}`,
  '687061796d656e7473',
  `992710${'646d656d6f'.repeat(1e4)}`,
].join('');

// Encode a value, checking that the encoding decodes back to the value
const encode = ({value}) => {
  const {cbor} = encodeAsCbor({value});

  deepEqual(decodeCbor({cbor}).value, value, 'Value is decoded back');

  return {cbor};
};

const tests = [
  {
    args: {value: {a: 1}},
    description: 'A value is encoded as CBOR',
    expected: {cbor: 'a1616101'},
  },
  {
    args: {
      value: {
        cert: Buffer.from('cert'),
        encrypted_macaroon: Buffer.from('macaroon'),
        socket: 'host:10009',
      },
    },
    description: 'Exported credentials are encoded',
    expected: {cbor: credentials},
  },
  {
    args: {
      value: {
        encrypted: Buffer.alloc(3, 1),
        iv: Buffer.alloc(16, 2),
        salt: Buffer.alloc(32, 3),
        settings: {
          algorithm: 'aes-256-gcm',
          derivation: 'scrypt',
          digest: 'sha512',
          encoding: undefined,
          key_length: 32,
          with: [undefined],
        },
        tag: Buffer.alloc(16, 4),
      },
    },
    description: 'Encrypted data is encoded with undefined values',
    expected: {cbor: encrypted},
  },
  {
    args: {
      value: {
        macaroon: Buffer.from('macaroon'),
        preimage: Buffer.alloc(32, 5),
      },
    },
    description: 'A service token is encoded',
    expected: {cbor: token},
  },
  {
    args: {
      value: [
        0,
        23,
        24,
        255,
        256,
        65535,
        65536,
        4294967295,
        4294967296,
        Number.MAX_SAFE_INTEGER,
        -1,
        -24,
        -25,
        -256,
        -257,
        -65537,
      ],
    },
    description: 'Integers are encoded in as few bytes as they fit into',
    expected: {cbor: integers},
  },
  {
    args: {value: [false, true, null, undefined]},
    description: 'Simple values are encoded',
    expected: {cbor: '84f4f5f6f7'},
  },
  {
    args: {value: '⚡é'},
    description: 'Text is encoded as UTF-8',
    expected: {cbor: '65e29aa1c3a9'},
  },
  {
    args: {value: {a: [1, {b: 'c'}], d: {}}},
    description: 'Nested values are encoded',
    expected: {cbor: 'a261618201a1616261636164a0'},
  },
  {
    args: {value: [Buffer.alloc(23), Buffer.alloc(24)]},
    description: 'Lengths over 23 are encoded after the initial byte',
    expected: {cbor: `8257${'00'.repeat(23)}5818${'00'.repeat(24)}`},
  },
  {
    args: {value: 'x'.repeat(256)},
    description: 'Lengths over 255 are encoded in two bytes',
    expected: {cbor: `790100${'78'.repeat(256)}`},
  },
  {
    args: {value: Buffer.alloc(65536, 7)},
    description: 'Lengths over 65535 are encoded in four bytes',
    expected: {cbor: `5a00010000${'07'.repeat(65536)}`},
  },
  {
    args: {value: largeValue},
    description: 'A value larger than a stream buffer is encoded in full',
    expected: {cbor: largeValueCbor},
  },
  {
    args: {value: 1.5},
    description: 'A fraction is not encoded',
    error: 'UnsupportedNumberToEncodeAsCbor',
  },
  {
    args: {value: 2 ** 53},
    description: 'An integer beyond the safe range is not encoded',
    error: 'UnsupportedNumberToEncodeAsCbor',
  },
  {
    args: {value: new Map()},
    description: 'Only plain objects are encoded as maps',
    error: 'UnsupportedValueToEncodeAsCbor',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, () => {
    if (!!error) {
      throws(() => encode(args), new Error(error), 'Got expected error');
    } else {
      deepEqual(encode(args), expected, 'Got expected encoding');
    }

    return;
  });
});
