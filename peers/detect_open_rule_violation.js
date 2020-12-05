const asyncAuto = require('async/auto');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {isArray} = Array;
const openRequestViolation = require('./open_request_violation');

/** Detect an open request rule violation

  {
    capacity: <Channel Capacity Tokens Number>
    lnd: <Authenticated LND API Object>
    local_balance: <Local Channel Balance Tokens Number>
    partner_public_key: <Open Request From Public Key Hex String>
    rules: [<Channel Open Request Rule String>]
  }

  @returns via cbk or Promise
  {
    [rule]: <Violated Rule String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.capacity) {
          return cbk([400, 'ExpectedChannelCapacityToDetectRuleViolation']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToDetectOpenChannelRuleViolation']);
        }

        if (args.local_balance === undefined) {
          return cbk([400, 'ExpectedLocalBalanceToDetectOpenRuleViolation']);
        }

        if (!args.partner_public_key) {
          return cbk([400, 'ExpectedPeerPublicKeyToDetectOpenRuleViolation']);
        }

        if (!isArray(args.rules)) {
          return cbk([400, 'ExpectedArrayOfRulesToDetectOpenRuleViolation']);
        }

        return cbk();
      },

      // Get the capacities fees for the node to use in rule parsing
      getNodeFees: ['validate', ({}, cbk) => {
        return getNode({
          lnd: args.lnd,
          public_key: args.partner_public_key,
        },
        cbk);
      }],

      // Evaluate rules to find a violation
      evaluate: ['getNodeFees', ({getNodeFees}, cbk) => {
        const key = args.partner_public_key;

        try {
          const {rule} = openRequestViolation({
            capacities: getNodeFees.channels.map(n => n.capacity),
            capacity: args.capacity,
            fee_rates: getNodeFees.channels
              .map(({policies}) => policies.find(n => n.public_key === key))
              .filter(n => !!n && n.fee_rate !== undefined)
              .map(n => n.fee_rate),
            local_balance: args.local_balance,
            public_key: args.partner_public_key,
            rules: args.rules,
          });

          return cbk(null, {rule});
        } catch (err) {
          return cbk([503, 'UnexpectedFailureEvaluatingOpenRule', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'evaluate'}, cbk));
  });
};
