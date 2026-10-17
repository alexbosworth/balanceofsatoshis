const {componentsOfTransaction} = require('@alexbosworth/blockchain');

const anchorOutputScript = require('./anchor_output_script');
const fundingKeys = require('./funding_keys');

/** Find our anchor output in a close transaction

  {
    [anchor_vout]: <LND Reported Anchor Output Index Number>
    [close_balance_spent_by]: <Close Balance Spent By Id Hex String>
    [close_balance_vout]: <Close Balance Output Index Number>
    close_payments: [{
      transaction_id: <HTLC Transaction Id Hex String>
      transaction_vout: <HTLC Transaction Output Index Number>
    }]
    close_transaction_id: <Close Transaction Id Hex String>
    [is_cooperative_close]: <Channel Was Cooperatively Closed Bool>
    [transaction]: <Raw Close Transaction Hex String>
  }

  @returns
  {
    [vout]: <Anchor Output Index Number>
  }
*/
module.exports = args => {
  // Exit early when LND reported the anchor output
  if (args.anchor_vout !== undefined) {
    return {vout: args.anchor_vout};
  }

  // Exit early when there are no anchors in a cooperative close
  if (!!args.is_cooperative_close || !args.transaction) {
    return {};
  }

  const {inputs, outputs} = componentsOfTransaction({
    transaction: args.transaction,
  });

  const [fundingSpend] = inputs;

  const {keys} = fundingKeys({witness: fundingSpend.witness});

  // Exit early when the funding keys that anchors are derived from are unknown
  if (!keys) {
    return {};
  }

  const anchorScripts = keys.map(key => anchorOutputScript({key}).script);

  // Outputs that resolved as the balance or as HTLCs are not anchors
  const htlcVouts = args.close_payments
    .filter(n => n.transaction_id === args.close_transaction_id)
    .map(n => n.transaction_vout);

  const balanceVout = args.close_balance_vout;

  const knownVouts = []
    .concat(balanceVout !== undefined ? [balanceVout] : [])
    .concat(htlcVouts);

  const anchors = outputs
    .map(({script, tokens}, vout) => ({script, tokens, vout}))
    .filter(n => !knownVouts.includes(n.vout))
    .filter(n => anchorScripts.includes(n.script));

  // Exit early when there are no anchor outputs
  if (!anchors.length) {
    return {};
  }

  const [anchor, otherAnchor] = anchors;

  // Exit early when both sides have an anchor, one of them is ours
  if (!!otherAnchor) {
    return {vout: anchor.vout};
  }

  // Exit early when a single anchor is ours as we had outputs to protect
  if (!!args.close_balance_spent_by || !!args.close_payments.length) {
    return {vout: anchor.vout};
  }

  return {};
};
