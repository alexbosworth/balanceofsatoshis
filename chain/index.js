const getChainFees = require('./get_chain_fees');
const getChannelCloses = require('./get_channel_closes');
const getDepositAddress = require('./get_deposit_address');
const getUtxos = require('./get_utxos');
const splitUtxos = require('./split_utxos');

module.exports = {
  getChainFees,
  getChannelCloses,
  getDepositAddress,
  getUtxos,
  splitUtxos,
};
