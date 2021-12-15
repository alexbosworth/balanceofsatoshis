const bjs = require("bitcoinjs-lib");
const ecc = require("tiny-secp256k1");
const { BIP32Factory } = require("bip32");
const b58 = require("bs58check");
const bip32 = BIP32Factory(ecc);

module.exports = ({ coop_close_address, network }) => {
  //set the network
  if (network === "mainnet") {
    network = bjs.networks.bitcoin;
  }
  if (network === "testnet") {
    network = bjs.networks.testnet;
  }
  if (network === "regtest") {
    network = bjs.networks.regtest;
  }

  try {
    bjs.address.toOutputScript(coop_close_address, network);
    return true;
  } catch (e) {
    return false;
  }
};
