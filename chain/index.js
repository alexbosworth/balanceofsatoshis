const getChainFees = require('./get_chain_fees');
const getChannelCloses = require('./get_channel_closes');
const getDepositAddress = require('./get_deposit_address');
const getMempoolSize = require('./get_mempool_size');
const getUtxos = require('./get_utxos');
const splitUtxos = require('./split_utxos');

module.exports = {
  getChainFees,
  getChannelCloses,
  getDepositAddress,
  getMempoolSize,
  getUtxos,
  splitUtxos,
};
