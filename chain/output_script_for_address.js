const {decodeBase58Address} = require('@alexbosworth/blockchain');
const {decodeBech32Address} = require('@alexbosworth/blockchain');
const {p2pkhOutputScript} = require('@alexbosworth/blockchain');
const {p2shOutputScript} = require('@alexbosworth/blockchain');
const {p2trOutputScript} = require('@alexbosworth/blockchain');
const {p2wpkhOutputScript} = require('@alexbosworth/blockchain');
const {p2wshOutputScript} = require('@alexbosworth/blockchain');

const {networks} = require('./networks');

const bufferAsHex = buffer => buffer.toString('hex');
const byteAsHex = n => n.toString(16).padStart(2, '0');
const byteLengthForP2tr = 32;
const byteLengthForP2wpkh = 20;
const opVersionOffset = 0x50;
const versionSegwit = 0;
const versionTaproot = 1;

/** Get the output script for an address

  {
    address: <Address String>
    network: <Network Name String>
  }

  @throws
  <Error>

  @returns
  {
    script: <Output Script Hex String>
  }
*/
module.exports = ({address, network}) => {
  const params = networks[network];

  if (!params) {
    throw new Error('UnsupportedNetworkToConvertAddressToOutputScript');
  }

  // Exit early when the address is a base58 address
  try {
    const {hash, version} = decodeBase58Address({address});

    if (version === params.p2pkh) {
      return {script: bufferAsHex(p2pkhOutputScript({hash}).script)};
    }

    if (version === params.p2sh) {
      return {script: bufferAsHex(p2shOutputScript({hash}).script)};
    }

    throw new Error('InvalidNetworkToConvertAddressToOutputScript');
  } catch (err) {
    // Continue on to bech32 decoding when the address is not base58
    if (err.message === 'InvalidNetworkToConvertAddressToOutputScript') {
      throw err;
    }
  }

  const {prefix, program, version} = decodeBech32Address({address});

  if (prefix !== params.bech32) {
    throw new Error('InvalidNetworkToConvertAddressToOutputScript');
  }

  if (version === versionSegwit && program.length === byteLengthForP2wpkh) {
    return {script: bufferAsHex(p2wpkhOutputScript({hash: program}).script)};
  }

  if (version === versionSegwit) {
    return {script: bufferAsHex(p2wshOutputScript({hash: program}).script)};
  }

  // Future segwit versions are OP_n followed by a push of the program
  if (version !== versionTaproot) {
    const push = byteAsHex(program.length);
    const versionOp = byteAsHex(opVersionOffset + version);

    return {script: `${versionOp}${push}${bufferAsHex(program)}`};
  }

  if (program.length !== byteLengthForP2tr) {
    throw new Error('UnexpectedByteLengthForPayToTaprootAddress');
  }

  return {script: bufferAsHex(p2trOutputScript({hash: program}).script)};
};
