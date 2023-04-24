const asyncAuto = require('async/auto');
const {decodeChanId} = require('bolt07');
const {getHeight} = require('ln-service');
const {getNode} = require('ln-service');
const {isIP} = require('net');
const {returnResult} = require('asyncjs-util');

const {isArray} = Array;
const isClear = sockets => !!sockets.find(n => !!isIP(n.socket.split(':')[0]));
const isOnion = sockets => !!sockets.find(n => /onion/.test(n.socket));
const openRequestViolation = require('./open_request_violation');

/** Detect an open request rule violation

  {
    capacity: <Channel Capacity Tokens Number>
    [is_private]: <Channel Request Is For Private Channel Bool>
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

      // Get the current chain height
      getHeight: ['validate', ({}, cbk) => getHeight({lnd: args.lnd}, cbk)],

      // Get the capacities fees for the node to use in rule parsing
      getNodeFees: ['validate', ({}, cbk) => {
        // Exit early when there are no rules to evaluate
        if (!args.rules.length) {
          return cbk(null, {});
        }

        return getNode({
          lnd: args.lnd,
          public_key: args.partner_public_key,
        },
        (err, res) => {
          const [code] = err || [];

          // Exit early when node has no graph details
          if (code === 404) {
            return cbk(null, {channels: [], sockets: []});
          }

          if (!!err) {
            return cbk(err);
          }

          return cbk(null, {channels: res.channels, sockets: res.sockets});
        });
      }],

      // Determine if peer advertises clearnet
      hasClearnet: ['validate', 'getNodeFees', ({getNodeFees}, cbk) => {
        const sockets = getNodeFees.sockets || []

        const isAdvertisingClearnet = !!sockets.length && !!isClear(sockets);

        return cbk(null, isAdvertisingClearnet);
      }],

      // Determine if peer advertises Tor
      hasTor: ['validate', 'getNodeFees', ({getNodeFees}, cbk) => {
        const sockets = getNodeFees.sockets || [];

        const isAdvertisingTor = !!sockets.length && !!isOnion(sockets);

        return cbk(null, isAdvertisingTor);
      }],

      // Evaluate rules to find a violation
      evaluate: [
        'getHeight',
        'getNodeFees',
        'hasClearnet',
        'hasTor',
        ({getHeight, getNodeFees, hasClearnet, hasTor}, cbk) =>
      {
        // Exit early when there are no rules to evaluate
        if (!args.rules.length) {
          return cbk(null, {});
        }

        const key = args.partner_public_key;

        const channelAges = getNodeFees.channels.map(({id}) => {
          const channelHeight = decodeChanId({channel: id}).block_height;

          return getHeight.current_block_height - channelHeight;
        });

        try {
          const {rule} = openRequestViolation({
            capacities: getNodeFees.channels.map(n => n.capacity),
            capacity: args.capacity,
            channel_ages: channelAges,
            fee_rates: getNodeFees.channels
              .map(({policies}) => policies.find(n => n.public_key === key))
              .filter(n => !!n && n.fee_rate !== undefined)
              .map(n => n.fee_rate),
            local_balance: args.local_balance,
            is_clearnet: hasClearnet,
            is_private: !!args.is_private,
            is_tor: hasTor,
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
