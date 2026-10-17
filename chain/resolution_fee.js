const {componentsOfTransaction} = require('@alexbosworth/blockchain');

const inputWeight = require('./input_weight');
const isContractSpend = require('./is_contract_spend');
const transactionFee = require('./transaction_fee');

const {round} = Math;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());

/** Calculate the share of a resolving tx fee attributable to a channel

  A resolving transaction may also spend outputs of other channels, in which
  case the fee is pro-rated by the weight of the inputs that spend the
  channel's own contract outputs. Inputs that spend neither are fee funding
  inputs and are not counted against the channel's share.

  Contract outputs without an output index refer to all outputs of the tx.
  A second level transaction can be shared between channels so its outputs
  are referred to individually.

  {
    contract_outputs: [{
      id: <Channel Contract Transaction Id Hex String>
      [vout]: <Channel Contract Transaction Output Index Number>
    }]
    id: <Resolving Transaction Id Hex String>
    other_contract_outputs: [{
      id: <Other Channel Contract Transaction Id Hex String>
      [vout]: <Other Channel Contract Transaction Output Index Number>
    }]
    transactions: [{
      [fee]: <Wallet Reported Fee Tokens Number>
      id: <Transaction Id Hex String>
      [transaction]: <Raw Transaction Hex String>
    }]
  }

  @returns
  {
    [fee]: <Attributable Fee Tokens Number>
  }
*/
module.exports = args => {
  const tx = args.transactions.find(n => n.id === args.id);

  // Exit early when the resolving transaction is not known
  if (!tx || !tx.transaction) {
    return {};
  }

  const {inputs} = componentsOfTransaction({transaction: tx.transaction});

  const own = inputs.filter(({id, vout}) => {
    return isContractSpend({id, vout, outputs: args.contract_outputs});
  });

  const other = inputs.filter(({id, vout}) => {
    return isContractSpend({id, vout, outputs: args.other_contract_outputs});
  });

  // Exit early when the transaction does not spend the channel's outputs
  if (!own.length) {
    return {};
  }

  const {fee} = transactionFee({
    fee: tx.fee,
    transaction: tx.transaction,
    transactions: args.transactions,
  });

  // Exit early when the total fee of the transaction is not known
  if (fee === undefined) {
    return {};
  }

  // Exit early when the fee is not shared with other channels
  if (!other.length) {
    return {fee};
  }

  const ownWeight = sumOf(own.map(inputWeight));
  const otherWeight = sumOf(other.map(inputWeight));

  return {fee: round(fee * ownWeight / (ownWeight + otherWeight))};
};
