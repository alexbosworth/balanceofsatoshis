const asyncAuto = require('async/auto');
const {getNetwork} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const {subscribeToOpenRequests} = require('ln-service');

const detectOpenRuleViolation = require('./detect_open_rule_violation');
const openRequestViolation = require('./open_request_violation');
const {outputScriptForAddress} = require('./../chain');

const {isArray} = Array;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const isTooLongReason = n => Buffer.byteLength(n, 'utf8') > 500;
const notEmpty = n => !!n.length ? n : undefined;

/** Reject inbound channels

  {
    addresses: [<Cooperative Close Address String>]
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [reason]: <Reason Error Message String>
    rules: [<Rule for Inbound Channel String>]
    trust: [<Trust Funding From Node With Identity Public Key Hex String>]
  }
*/
module.exports = ({addresses, lnd, logger, reason, rules, trust}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(addresses)) {
          return cbk([400, 'ExpectedArrayOfCloseAddressesToInterceptChans']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRejectInboundChannels']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToRejectInboundChannels']);
        }

        if (!!reason && isTooLongReason(reason)) {
          return cbk([400, 'ExpectedShorterRejectionReasonToRejectChannels']);
        }

        if (!isArray(rules)) {
          return cbk([400, 'ExpectedArrayOfRejectRulesToRejectChannels']);
        }

        if (!!trust.filter(n => !isPublicKey(n)).length) {
          return cbk([400, 'ExpectedValidTrustPublicKeysToInterceptChannels']);
        }

        if (!!rules.length) {
          // Check if a test request would cause any rules parsing errors
          try {
            openRequestViolation({
              rules,
              capacities: [1],
              capacity: 2,
              channel_ages: [],
              fee_rates: [3],
              is_private: false,
              local_balance: 4,
              public_key: Buffer.alloc(33, 2).toString('hex'),
            });
          } catch (err) {
            return cbk([400, 'InvalidInboundChannelRequestOpenRule', {err}]);
          }
        }

        if (!isArray(trust)) {
          return cbk([400, 'ExpectedArrayOfTrustedKeysToInterceptChannels']);
        }

        return cbk();
      },

      // Check the cooperative close address
      checkAddress: ['validate', ({}, cbk) => {
        // Exit early when there is no address to check
        if (!addresses.length) {
          return cbk();
        }

        // Find the network of this node to compare it to the provided address
        return getNetwork({lnd}, (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          // Exit early when network is not recognized
          if (!res.bitcoinjs) {
            return cbk();
          }

          // Make sure that the addresses look ok
          try {
            addresses.forEach(address => {
              outputScriptForAddress({address, network: res.network});
            });
          } catch (err) {
            return cbk([400, 'FailedToParseCooperativeCloseAddress', {err}]);
          }

          return cbk();
        });
      }],

      // Subscribe to open requests
      subscribe: ['checkAddress', ({}, cbk) => {
        const sub = subscribeToOpenRequests({lnd});

        // Copy the addresses into a pool
        const cooperativeCloseAddresses = addresses.slice();

        // Exit with error when there is an error
        sub.once('error', err => {
          sub.removeAllListeners();

          return cbk([503, 'UnexpectedErrorInOpenRequestsSub', {err}]);
        });

        logger.info({
          enforcing_inbound_channel_rules: rules,
          requesting_cooperative_close_address: notEmpty(addresses),
          do_not_require_conf_funds_from: notEmpty(trust),
        });

        sub.on('channel_request', request => {
          const peerId = request.partner_public_key;

          // Exit early when requester is not trusted for trusted funding
          if (!!request.is_trusted_funding && !trust.includes(peerId)) {
            logger.info({
              rejected: peerId,
              reason: {trusted_funding_not_configured_for_peer: true},
            });

            return request.reject({reason: 'TrustedFundingAccessDenied'});
          }

          return detectOpenRuleViolation({
            lnd,
            rules,
            capacity: request.capacity,
            is_private: request.is_private,
            local_balance: request.local_balance,
            partner_public_key: peerId,
          },
          (err, res) => {
            if (!!err) {
              logger.error({err});

              // Reject without reason when there is a generic failure
              return request.reject({});
            }

            // Exit early when a channel open rule violation rejects a channel
            if (!!res.rule) {
              logger.info({
                rejected: peerId,
                capacity: request.capacity,
                rule: res.rule,
              });

              return request.reject({reason});
            }

            // Restock cooperative addresses when depleted
            if (!!addresses.length && !cooperativeCloseAddresses.length) {
              addresses.forEach(n => cooperativeCloseAddresses.push(n));
            }

            // Cycle through cooperative close addresses
            const address = cooperativeCloseAddresses.shift();

            // Accept the channel open request
            return request.accept({
              cooperative_close_address: address,
              is_trusted_funding: request.is_trusted_funding,
            });
          });

          return;
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
