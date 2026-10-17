/** Describe the outcome of a closed channel HTLC payment output

  {
    [is_paid]: <Payment Is Claimed With Preimage Bool>
    [is_pending]: <Payment Resolution Is Pending Bool>
    [is_refunded]: <Payment Timed Out And Went Back To Payer Bool>
  }

  @returns
  {
    outcome: <Payment Outcome String>
  }
*/
module.exports = args => {
  if (!!args.is_paid) {
    return {outcome: 'paid'};
  }

  if (!!args.is_refunded) {
    return {outcome: 'refunded'};
  }

  if (!!args.is_pending) {
    return {outcome: 'pending'};
  }

  return {outcome: 'unclaimed'};
};
