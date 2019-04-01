const {Transaction} = require('bitcoinjs-lib');

const channelResolution = require('./channel_resolution');

/** Resolution type

  {
    transaction: <Transaction Hex String>
    vin: <Transaction Input Index Number>
  }

  @returns
  {
    type: <Resolution Type String>
  }
*/
module.exports = ({transaction, vin}) => {
  const tx = Transaction.fromHex(transaction);

  const witness = tx.ins[vin].witness.map(n => n.toString('hex'));

  return {type: channelResolution({witness}).type};
};
