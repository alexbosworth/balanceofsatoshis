const {componentsOfTransaction} = require('@alexbosworth/blockchain');

const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());

/** Calculate the fee paid by a transaction

  The fee is known when the wallet reports it, or when every output that the
  transaction spends is known from the raw transaction that created it.

  {
    [fee]: <Wallet Reported Fee Tokens Number>
    transaction: <Raw Transaction Hex String>
    transactions: [{
      id: <Transaction Id Hex String>
      [transaction]: <Raw Transaction Hex String>
    }]
  }

  @returns
  {
    [fee]: <Fee Tokens Number>
  }
*/
module.exports = args => {
  // Exit early when the wallet knows the fee
  if (!!args.fee) {
    return {fee: args.fee};
  }

  const {inputs, outputs} = componentsOfTransaction({
    transaction: args.transaction,
  });

  const spent = inputs.map(input => {
    const [spending] = args.transactions
      .filter(n => !!n.transaction)
      .filter(n => n.id === input.id)
      .map(({transaction}) => componentsOfTransaction({transaction}));

    // Exit early when the transaction that created the input is not known
    if (!spending) {
      return undefined;
    }

    return spending.outputs[input.vout];
  });

  // Exit early when the value of a spent output is unknown
  if (spent.includes(undefined)) {
    return {};
  }

  const spentTokens = sumOf(spent.map(n => n.tokens));

  return {fee: spentTokens - sumOf(outputs.map(n => n.tokens))};
};
