const {componentsOfTransaction} = require('@alexbosworth/blockchain');

const closeFeePayer = require('./close_fee_payer');
const linkPaymentStages = require('./link_payment_stages');
const resolutionFee = require('./resolution_fee');

const outputsOf = tx => componentsOfTransaction({transaction: tx}).outputs;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const uniq = arr => Array.from(new Set(arr));

/** Calculate channel closing fees paid

  Fees are only returned when every fee that may have been paid is known.

  Fees include the close transaction fee when it was paid by this side, the
  fees of our own transactions that resolve the outputs of the close, and the
  value of an anchor output that was never swept and so is lost.

  When a resolving transaction also spends the outputs of other channels, the
  fee is pro-rated by the weight of the inputs spending this channel's outputs.

  {
    [anchor_is_confirmed]: <Anchor Sweep Is Confirmed Bool>
    [anchor_is_pending]: <Anchor Sweep Is Pending Confirmation Bool>
    [anchor_spent_by]: <Anchor Sweep Transaction Id Hex String>
    [anchor_vout]: <Anchor Output Index Number>
    [capacity]: <Channel Capacity Tokens Number>
    [close_balance_spent_by]: <Close Balance Spent By Id Hex String>
    close_payments: [{
      is_outgoing: <Payment Is Outgoing Bool>
      is_paid: <Payment Is Claimed With Preimage Bool>
      is_pending: <Payment Resolution Is Pending Bool>
      is_refunded: <Payment Timed Out And Went Back To Payer Bool>
      [spent_by]: <Spent By Transaction Id Hex String>
      tokens: <Associated Tokens Number>
      transaction_id: <Transaction Id Hex String>
      transaction_vout: <Transaction Output Index Number>
    }]
    close_transaction_id: <Close Transaction Id Hex String>
    [is_cooperative_close]: <Channel Was Cooperatively Closed Bool>
    [is_partner_closed]: <Channel Was Closed By Peer Bool>
    [is_partner_initiated]: <Channel is Initiated By Peer Bool>
    other_contract_outputs: [{
      id: <Other Channel Contract Transaction Id Hex String>
      [vout]: <Other Channel Contract Transaction Output Index Number>
    }]
    transactions: [{
      [fee]: <Paid Transaction Fee Tokens Number>
      id: <Transaction Id Hex String>
      [transaction]: <Raw Transaction Hex String>
    }]
  }

  @returns
  {
    [fees]: <Known Closing Fees Paid Tokens Number>
  }
*/
module.exports = args => {
  const [closeTx] = args.transactions
    .filter(n => !!n.transaction)
    .filter(n => n.id === args.close_transaction_id);

  const closeTransaction = !!closeTx ? closeTx.transaction : undefined;

  const payer = closeFeePayer({
    is_cooperative_close: args.is_cooperative_close,
    is_partner_closed: args.is_partner_closed,
    is_partner_initiated: args.is_partner_initiated,
    transaction: closeTransaction,
  });

  // Exit early when it is not known which side paid the close tx fee
  if (payer.is_peer_paying === undefined) {
    return {};
  }

  // Payments resolved over two stages are linked to find their final status
  const {payments} = linkPaymentStages({
    close_payments: args.close_payments,
    transactions: args.transactions,
  });

  // Exit early when a resolution is still pending, fees are not yet final
  if (!!args.anchor_is_pending || !!payments.find(n => !!n.is_pending)) {
    return {};
  }

  // Close outputs are spent in resolving transactions that may be our own
  const ownSpends = args.close_payments
    .filter(n => !!n.spent_by)
    .filter(payment => {
      // Exit early when the spend is a first stage second level transaction
      if (!!payment.is_pending) {
        return true;
      }

      return !!payment.is_outgoing ? !!payment.is_refunded : !!payment.is_paid;
    })
    .map(n => n.spent_by);

  const resolvingIds = uniq([]
    .concat(!!args.close_balance_spent_by ? [args.close_balance_spent_by] : [])
    .concat(!!args.anchor_spent_by ? [args.anchor_spent_by] : [])
    .concat(ownSpends));

  // Close tx outputs and specific second level tx outputs are this channel's
  const contractOutputs = []
    .concat({id: args.close_transaction_id})
    .concat(args.close_payments.map(payment => ({
      id: payment.transaction_id,
      vout: payment.transaction_vout,
    })));

  const resolvingFees = resolvingIds.map(id => {
    return resolutionFee({
      id,
      contract_outputs: contractOutputs,
      other_contract_outputs: args.other_contract_outputs,
      transactions: args.transactions,
    }).fee;
  });

  // Exit early when the fee of a resolving transaction is not known
  if (resolvingFees.includes(undefined)) {
    return {};
  }

  const closeOutputs = !closeTransaction ? [] : outputsOf(closeTransaction);

  const anchor = closeOutputs[args.anchor_vout];

  // An anchor output that was never swept is lost and counted as a fee
  const isAnchorLost = args.anchor_vout !== undefined && !args.anchor_spent_by;

  // Exit early when the value of a lost anchor output is not known
  if (!!isAnchorLost && !anchor) {
    return {};
  }

  const lostTokens = !isAnchorLost ? Number() : anchor.tokens;

  const resolvingTokens = sumOf(resolvingFees) + lostTokens;

  // Exit early when the peer paid the close tx fee
  if (!!payer.is_peer_paying) {
    return {fees: resolvingTokens};
  }

  // Exit early when the close tx fee was paid but the close tx is not known
  if (!args.capacity || !closeTransaction) {
    return {};
  }

  const closeFee = args.capacity - sumOf(closeOutputs.map(n => n.tokens));

  return {fees: closeFee + resolvingTokens};
};
