/** Describe the outcome of a closed channel anchor output

  {
    [is_confirmed]: <Anchor Output Spend Is Confirmed Bool>
    [is_pending]: <Anchor Output Spend Is Pending Confirmation Bool>
  }

  @returns
  {
    outcome: <Anchor Outcome String>
  }
*/
module.exports = args => {
  if (!!args.is_confirmed) {
    return {outcome: 'swept'};
  }

  if (!!args.is_pending) {
    return {outcome: 'pending'};
  }

  return {outcome: 'unclaimed'};
};
