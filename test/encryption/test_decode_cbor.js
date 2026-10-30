const {deepEqual} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const {decodeCbor} = require('./../../encryption');

// Encodings made by the cbor package, so data from before is still decoded
const credentials = 'a36463657274446365727472656e637279707465645f6d616361726f6f6e486d616361726f6f6e66736f636b6574f7';
const encrypted = 'a569656e637279707465644301010162697650020202020202020202020202020202026473616c74582003030303030303030303030303030303030303030303030303030303030303036873657474696e6773a669616c676f726974686d6b6165732d3235362d67636d6a64657269766174696f6e66736372797074666469676573746673686135313268656e636f64696e67f76a6b65795f6c656e6774681820647769746881f7637461675004040404040404040404040404040404';
const integers = '900017181818ff19010019ffff1a000100001affffffff1b00000001000000001b001fffffffffffff2037381838ff3901003a00010000';
const token = 'a2686d616361726f6f6e486d616361726f6f6e68707265696d61676558200505050505050505050505050505050505050505050505050505050505050505';

const tests = [
  {
    args: {cbor: 'a1616101'},
    description: 'A map is decoded',
    expected: {value: {a: 1}},
  },
  {
    args: {cbor: credentials},
    description: 'Exported credentials without a socket are decoded',
    expected: {
      value: {
        cert: Buffer.from('cert'),
        encrypted_macaroon: Buffer.from('macaroon'),
        socket: undefined,
      },
    },
  },
  {
    args: {cbor: encrypted},
    description: 'Encrypted data is decoded',
    expected: {
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
  },
  {
    args: {cbor: token},
    description: 'A service token is decoded',
    expected: {
      value: {
        macaroon: Buffer.from('macaroon'),
        preimage: Buffer.alloc(32, 5),
      },
    },
  },
  {
    args: {cbor: integers},
    description: 'Integers of every size are decoded',
    expected: {
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
  },
  {
    args: {cbor: '84f4f5f6f7'},
    description: 'Simple values are decoded',
    expected: {value: [false, true, null, undefined]},
  },
  {
    args: {cbor: '65e29aa1c3a9'},
    description: 'Text is decoded as UTF-8',
    expected: {value: '⚡é'},
  },
  {
    args: {cbor: 'a261618201a1616261636164a0'},
    description: 'Nested values are decoded',
    expected: {value: {a: [1, {b: 'c'}], d: {}}},
  },
  {
    args: {cbor: `5a00010000${'07'.repeat(65536)}`},
    description: 'Long bytes are decoded',
    expected: {value: Buffer.alloc(65536, 7)},
  },
  {
    args: {cbor: undefined},
    description: 'Hex encoded CBOR is required',
    error: 'ExpectedHexEncodedCborToDecode',
  },
  {
    args: {cbor: ''},
    description: 'Empty data is not decoded',
    error: 'UnexpectedEndOfCborData',
  },
  {
    args: {cbor: '5801'},
    description: 'Bytes that are cut short are not decoded',
    error: 'UnexpectedEndOfCborData',
  },
  {
    args: {cbor: '9a7fffffff'},
    description: 'An array longer than its data is not decoded',
    error: 'UnexpectedEndOfCborData',
  },
  {
    args: {cbor: 'a1616101ff'},
    description: 'Data after the item is not decoded',
    error: 'UnexpectedDataAfterCborItem',
  },
  {
    args: {cbor: 'a10101'},
    description: 'Map keys have to be text',
    error: 'ExpectedTextKeysInCborMap',
  },
  {
    args: {cbor: '5f'},
    description: 'Indefinite lengths are not supported',
    error: 'UnsupportedCborAdditionalInfo',
  },
  {
    args: {cbor: 'c0'},
    description: 'Tags are not supported',
    error: 'UnsupportedCborTag',
  },
  {
    args: {cbor: 'f93c00'},
    description: 'Floats are not supported',
    error: 'UnsupportedCborSimpleValue',
  },
  {
    args: {cbor: '1b0020000000000000'},
    description: 'Integers beyond the safe range are not supported',
    error: 'UnsupportedLargeCborNumber',
  },
  {
    args: {cbor: '3b001fffffffffffff'},
    description: 'Negative integers beyond the safe range are not supported',
    error: 'UnsupportedLargeCborNumber',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, () => {
    if (!!error) {
      throws(() => decodeCbor(args), new Error(error), 'Got expected error');
    } else {
      deepEqual(decodeCbor(args), expected, 'Got expected value');
    }

    return;
  });
});
