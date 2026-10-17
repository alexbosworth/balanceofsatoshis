/** Derive the contract outputs of a channel from its close details

  The outputs of the close transaction all belong to the channel, while HTLC
  outputs are referred to specifically as a second level transaction may be
  shared with other channels.

  {
    [close_transaction_id]: <Close Transaction Id Hex String>
    payments: [{
      transaction_id: <HTLC Transaction Id Hex String>
      transaction_vout: <HTLC Transaction Output Index Number>
    }]
  }

  @returns
  [{
    id: <Contract Transaction Id Hex String>
    [vout]: <Contract Transaction Output Index Number>
  }]
*/
module.exports = args => {
  const id = args.close_transaction_id;

  const closeOutputs = !id ? [] : [{id}];

  return closeOutputs.concat(args.payments.map(payment => ({
    id: payment.transaction_id,
    vout: payment.transaction_vout,
  })));
};
