const {address} = require('bitcoinjs-lib');
const {networks} = require('bitcoinjs-lib');

const bufferAsHex = buffer => buffer.toString('hex');
const byteLengthForP2tr = 32;
const {fromBech32} = address;
const names = {btc: 'mainnet', btcregtest: 'regtest', btctestnet: 'testnet'};
const prefixForP2tr = '5120';
const toOutputScript = (a, n) => address.toOutputScript(a, n).toString('hex');
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
  try {
    return {
      script: bufferAsHex(toOutputScript(address, networks[names[network]])),
    };
  } catch (err) {
    // Exit early when this is not a bech32 address
    try {
      fromBech32(address);
    } catch (_) {
      throw err;
    }

    const {data, prefix, version} = fromBech32(address);

    if (prefix !== networks[names[network]].bech32) {
      throw new Error('InvalidNetworkToConvertAddressToOutputScript');
    }

    if (version !== versionTaproot) {
      throw new Error('UnexpectedVersionOfAddressToConverToOutputScript');
    }

    if (data.length !== byteLengthForP2tr) {
      throw new Error('UnexpectedByteLengthForPayToTaprootAddress');
    }

    return {script: `${prefixForP2tr}${bufferAsHex(data)}`};
  }
};
