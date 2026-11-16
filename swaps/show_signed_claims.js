const selectByFeeRate = require('./select_by_fee_rate');
const {swapOutSafetyNotes} = require('./constants');

const asRate = rate => Math.floor(rate * 100) / 100;
const {isArray} = Array;

/** Show the signed claims of a swap out that are most likely to be used

  {
    claims: [{
      fee_rate: <Fee Tokens Per VByte Number>
      height: <Broadcast at Block Height Number>
      transaction: <Signed Claim Transaction Hex String>
    }]
    [fee_rate]: <Current Chain Fee Tokens Per VByte Number>
    logger: <Winston Logger Object>
  }

  @throws
  <Error>
*/
module.exports = args => {
  if (!isArray(args.claims)) {
    throw new Error('ExpectedArrayOfSignedClaimsToShow');
  }

  if (!args.logger) {
    throw new Error('ExpectedLoggerToShowSignedClaims');
  }

  // Without the current fee rate, claims show from the lowest fee rate
  const {items} = selectByFeeRate({
    fee_rate: args.fee_rate,
    items: args.claims,
  });

  const count = `${items.length} of ${args.claims.length}`;

  // Fee rates are rounded down so a claim never shows more than it pays
  const claims = items.map(claim => ({
    fee_rate: asRate(claim.fee_rate),
    height: claim.height,
    transaction: claim.transaction,
  }));

  // Claims are logged before returning, so before the secret is given out
  args.logger.info({
    signed_claims: {
      note: swapOutSafetyNotes.claims,
      current_fee_rate: args.fee_rate,
      showing: `${count}, ${swapOutSafetyNotes.claims_shown}`,
      transactions: claims,
    },
  });

  return;
};
