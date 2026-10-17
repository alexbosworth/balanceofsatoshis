const {componentsOfTransaction} = require('@alexbosworth/blockchain');

const anchorOutcome = require('./anchor_outcome');
const linkPaymentStages = require('./link_payment_stages');
const paymentOutcome = require('./payment_outcome');
const {sortBy} = require('./../arrays');

const sortByVout = arr => sortBy({array: arr, attribute: 'vout'}).sorted;

/** Derive the resolutions of closed channel outputs from LND close details

  Output values for balance and anchor outputs are only known when the close
  transaction is present in the wallet transactions

  {
    [anchor_is_confirmed]: <Anchor Output Spend Is Confirmed Bool>
    [anchor_is_pending]: <Anchor Output Spend Is Pending Confirmation Bool>
    [anchor_spent_by]: <Anchor Sweep Transaction Id Hex String>
    [anchor_vout]: <Anchor Output Index Number>
    [close_balance_spent_by]: <Balance Sweep Transaction Id Hex String>
    [close_balance_vout]: <Balance Output Index Number>
    close_payments: [{
      is_outgoing: <Payment Is Outgoing Bool>
      is_paid: <Payment Is Claimed With Preimage Bool>
      is_pending: <Payment Resolution Is Pending Bool>
      is_refunded: <Payment Timed Out And Went Back To Payer Bool>
      [spent_by]: <Close Transaction Spent By Transaction Id Hex String>
      tokens: <Associated Tokens Number>
      transaction_id: <Transaction Id Hex String>
      transaction_vout: <Transaction Output Index Number>
    }]
    close_transaction_id: <Close Transaction Id Hex String>
    transactions: [{
      id: <Transaction Id Hex String>
      [transaction]: <Raw Transaction Hex String>
    }]
  }

  @returns
  {
    resolutions: [{
      [transaction_id]: <Latest Resolving Transaction Id Hex String>
      type: <Resolution Type String>
      [value]: <Output Value Tokens Number>
    }]
  }
*/
module.exports = args => {
  // Output values are only known when the close tx is in the wallet
  const [closeTx] = args.transactions
    .filter(n => !!n.transaction)
    .filter(n => n.id === args.close_transaction_id)
    .map(({transaction}) => componentsOfTransaction({transaction}));

  const outputs = !!closeTx ? closeTx.outputs : [];

  const tokensAt = vout => !outputs[vout] ? undefined : outputs[vout].tokens;

  const anchorResolution = anchorOutcome({
    is_confirmed: args.anchor_is_confirmed,
    is_pending: args.anchor_is_pending,
  });

  const anchor = {
    transaction_id: args.anchor_spent_by,
    type: `anchor_${anchorResolution.outcome}`,
    value: tokensAt(args.anchor_vout),
    vout: args.anchor_vout,
  };

  const balance = {
    transaction_id: args.close_balance_spent_by,
    type: 'balance_swept',
    value: tokensAt(args.close_balance_vout),
    vout: args.close_balance_vout,
  };

  // HTLCs resolved over two stages are linked to get their final outcome
  const {payments} = linkPaymentStages({
    close_payments: args.close_payments,
    transactions: args.transactions,
  });

  const htlcs = payments.map(payment => {
    const direction = !!payment.is_outgoing ? 'outgoing' : 'incoming';

    const {outcome} = paymentOutcome({
      is_paid: payment.is_paid,
      is_pending: payment.is_pending,
      is_refunded: payment.is_refunded,
    });

    return {
      transaction_id: payment.spent_by,
      type: `${direction}_htlc_${outcome}`,
      value: payment.tokens,
      vout: payment.transaction_vout,
    };
  });

  // Anchor and balance resolutions are only present when LND reported them
  const resolutions = []
    .concat(args.anchor_vout !== undefined ? [anchor] : [])
    .concat(!!args.close_balance_spent_by ? [balance] : [])
    .concat(htlcs);

  return {
    resolutions: sortByVout(resolutions).map(resolution => ({
      transaction_id: resolution.transaction_id || undefined,
      type: resolution.type,
      value: resolution.value,
    })),
  };
};
