const {Transaction} = require('bitcoinjs-lib');

const {fromHex} = Transaction;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());

/** Calculate channel closing fees paid

  {
    [capacity]: <Channel Capacity Tokens Number>
    [close_balance_spent_by]: <Close Balance Spent By Id Hex String>
    close_transaction_id: <Close Transaction Id Hex String>
    is_partner_initiated: <Channel is Initiated By Peer Bool>
    transactions: [{
      [fee]: <Paid Transaction Fee Tokens Number>
      [transaction]: <Raw Transaction Hex String>
    }]
  }

  @returns
  {
    fees: <Closing Fees Paid Number>
  }
*/
module.exports = args => {
  const closer = args.transactions
    .filter(n => !!n.transaction)
    .find(n => n.id === args.close_transaction_id);

  const balanceSpend = args.transactions
    .find(n => n.id === args.close_balance_spent_by);

  // Exit early when the partner was responsible for close fees
  if (args.is_partner_initiated === true) {
    return {fees: !!balanceSpend ? balanceSpend.fee : Number()};
  }

  // Exit early when the closing transaction isn't known
  if (!args.capacity || !closer || !closer.transaction) {
    return {};
  }

  // Calculate the value of the outputs in the tx that spends the capacity
  const outValue = sumOf(fromHex(closer.transaction).outs.map(n => n.value));

  const fees = []
    .concat(args.capacity - outValue)
    .concat(!!balanceSpend ? balanceSpend.fee : Number());

  return {fees: sumOf(fees)};
};
