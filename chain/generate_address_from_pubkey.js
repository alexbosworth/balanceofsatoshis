const bjs = require("bitcoinjs-lib");
const ecc = require("tiny-secp256k1");
const { BIP32Factory } = require("bip32");
const b58 = require("bs58check");
const bip32 = BIP32Factory(ecc);

module.exports = ({ network, masterPubKey, index = 0 }) => {
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

  const xpub = anypubToXpub(masterPubKey);

  //generate an address, using p2sh wrapper over p2wpkh to support legacy wallets
  const { address } = bjs.payments.p2sh({
    redeem: bjs.payments.p2wpkh({
      pubkey: bip32.fromBase58(xpub).derive(0).derive(index).publicKey,
      network,
    }),
  });

  return { address };
};

//convert any type of pubkey to xpub
function anypubToXpub(masterPubKey) {
  let data = b58.decode(masterPubKey);
  data = data.slice(4);
  data = Buffer.concat([Buffer.from("0488b21e", "hex"), data]);
  return b58.encode(data);
}
