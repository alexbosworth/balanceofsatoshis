const {componentsOfTransaction} = require('@alexbosworth/blockchain');

/** Link HTLC payment resolutions that resolve over two stages

  An HTLC on a local commitment is first spent into a second level transaction
  and then the second level output is spent. LND keeps a first stage report as
  well as the report of the second stage, so the second stage is linked to the
  first stage to get the final outcome of the HTLC.

  A second level transaction can spend multiple HTLCs. Each HTLC output in it
  is at the same index as the HTLC input that funds it.

  {
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
    transactions: [{
      id: <Transaction Id Hex String>
      [transaction]: <Raw Transaction Hex String>
    }]
  }

  @returns
  {
    payments: [{
      is_outgoing: <Payment Is Outgoing Bool>
      is_paid: <Payment Is Claimed With Preimage Bool>
      is_pending: <Payment Resolution Is Pending Bool>
      is_refunded: <Payment Timed Out And Went Back To Payer Bool>
      [spent_by]: <Final Spent By Transaction Id Hex String>
      tokens: <Associated Tokens Number>
      transaction_id: <Transaction Id Hex String>
      transaction_vout: <Transaction Output Index Number>
    }]
  }
*/
module.exports = args => {
  // First stage reports are pending spends into a second level transaction
  const firstStages = args.close_payments.filter(payment => {
    return !!payment.is_pending && !!payment.spent_by;
  });

  // Find the second stage report for each first stage report
  const links = firstStages.map(firstStage => {
    const isSameDirection = n => n.is_outgoing === firstStage.is_outgoing;

    const secondStages = args.close_payments
      .filter(n => n.transaction_id === firstStage.spent_by)
      .filter(isSameDirection);

    const otherFirstStages = firstStages
      .filter(n => n !== firstStage)
      .filter(n => n.spent_by === firstStage.spent_by)
      .filter(isSameDirection);

    // Exit early when no other HTLC like this is in the second level tx
    if (!otherFirstStages.length) {
      const [secondStage] = secondStages;

      return {firstStage, secondStage};
    }

    const [secondLevelTx] = args.transactions
      .filter(n => !!n.transaction)
      .filter(n => n.id === firstStage.spent_by)
      .map(({transaction}) => componentsOfTransaction({transaction}));

    // Exit early when the second level tx is not known to pair the outputs
    if (!secondLevelTx) {
      return {firstStage};
    }

    const vout = secondLevelTx.inputs.findIndex(input => {
      if (input.id !== firstStage.transaction_id) {
        return false;
      }

      return input.vout === firstStage.transaction_vout;
    });

    const secondStage = secondStages.find(n => n.transaction_vout === vout);

    return {firstStage, secondStage};
  });

  const linked = links.filter(link => !!link.secondStage);

  // Second stages are folded into the first stage that they continue
  const payments = args.close_payments
    .filter(payment => !linked.find(n => n.secondStage === payment))
    .map(payment => {
      const link = linked.find(n => n.firstStage === payment);

      // Exit early when there is no second stage to link
      if (!link) {
        return payment;
      }

      return {
        is_outgoing: payment.is_outgoing,
        is_paid: link.secondStage.is_paid,
        is_pending: link.secondStage.is_pending,
        is_refunded: link.secondStage.is_refunded,
        spent_by: link.secondStage.spent_by,
        tokens: payment.tokens,
        transaction_id: payment.transaction_id,
        transaction_vout: payment.transaction_vout,
      };
    });

  return {payments};
};
