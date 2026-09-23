const {deepEqual} = require('node:assert').strict;
const {throws} = require('node:assert').strict;
const test = require('node:test');

const {encodeBase58Address} = require('@alexbosworth/blockchain');
const {encodeBech32Address} = require('@alexbosworth/blockchain');

const method = require('./../../chain/output_script_for_address');

const hash20 = Buffer.alloc(20, 7);
const hash32 = Buffer.alloc(32, 9);

const base58 = (version, hash) => encodeBase58Address({hash, version}).address;

const bech32 = (prefix, version, program) => {
  return encodeBech32Address({prefix, program, version}).address;
};

const tests = [
  {
    args: {address: base58(0, hash20), network: 'network'},
    description: 'A known network is required',
    error: 'UnsupportedNetworkToConvertAddressToOutputScript',
  },
  {
    args: {address: base58(0, hash20), network: 'btc'},
    description: 'Get the output script for a p2pkh address',
    expected: {script: `76a914${hash20.toString('hex')}88ac`},
  },
  {
    args: {address: base58(196, hash20), network: 'btctestnet'},
    description: 'Get the output script for a p2sh address',
    expected: {script: `a914${hash20.toString('hex')}87`},
  },
  {
    args: {address: base58(111, hash20), network: 'btc'},
    description: 'A base58 address must be for the network',
    error: 'InvalidNetworkToConvertAddressToOutputScript',
  },
  {
    args: {address: 'address', network: 'btc'},
    description: 'An address must be a valid address',
    error: 'ExpectedLongerBech32EncodedStringToDecode',
  },
  {
    args: {address: bech32('tb', 0, hash20), network: 'btc'},
    description: 'A bech32 address must be for the network',
    error: 'InvalidNetworkToConvertAddressToOutputScript',
  },
  {
    args: {address: bech32('bc', 0, hash20), network: 'btc'},
    description: 'Get the output script for a p2wpkh address',
    expected: {script: `0014${hash20.toString('hex')}`},
  },
  {
    args: {address: bech32('bcrt', 0, hash32), network: 'btcregtest'},
    description: 'Get the output script for a p2wsh address',
    expected: {script: `0020${hash32.toString('hex')}`},
  },
  {
    args: {address: bech32('bc', 1, hash32), network: 'btc'},
    description: 'Get the output script for a p2tr address',
    expected: {script: `5120${hash32.toString('hex')}`},
  },
  {
    args: {address: bech32('bc', 1, hash20), network: 'btc'},
    description: 'A p2tr address must have a 32 byte program',
    error: 'UnexpectedByteLengthForPayToTaprootAddress',
  },
  {
    args: {address: bech32('bc', 16, Buffer.alloc(2, 1)), network: 'btc'},
    description: 'Get the output script for a future segwit version address',
    expected: {script: '60020101'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, () => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got expected error');
    } else {
      deepEqual(method(args), expected, 'Got expected result');
    }

    return;
  });
});
