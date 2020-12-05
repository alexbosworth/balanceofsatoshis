const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {subscribeToOpenRequests} = require('ln-service');

const detectOpenRuleViolation = require('./detect_open_rule_violation');
const openRequestViolation = require('./open_request_violation');

const {isArray} = Array;
const isTooLongReason = n => Buffer.byteLength(n, 'utf8') > 500;

/** Reject inbound channels

  {
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [reason]: <Reason Error Message String>
    rules: [<Rule for Inbound Channel String>]
  }
*/
module.exports = ({lnd, logger, reason, rules}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
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

        if (!rules.length) {
          return cbk([400, 'ExpectedAtLeastOneInboundChannelOpenRule']);
        }

        // Check if a test request would cause any rules parsing errors
        try {
          openRequestViolation({
            rules,
            capacities: [1],
            capacity: 2,
            fee_rates: [3],
            local_balance: 4,
            public_key: Buffer.alloc(33, 2).toString('hex'),
          });
        } catch (err) {
          return cbk([400, 'InvalidInboundChannelRequestOpenRule', {err}]);
        }

        return cbk();
      },

      // Subscribe to open requests
      subscribe: ['validate', ({}, cbk) => {
        const sub = subscribeToOpenRequests({lnd});

        // Exit with error when there is an error
        sub.once('error', err => {
          sub.removeAllListeners();

          return cbk([503, 'UnexpectedErrorInOpenRequestsSub', {err}]);
        });

        logger.info({enforcing_inbound_channel_rules: rules});

        sub.on('channel_request', request => {
          return detectOpenRuleViolation({
            lnd,
            rules,
            capacity: request.capacity,
            local_balance: request.local_balance,
            partner_public_key: request.partner_public_key,
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
                rejected: request.partner_public_key,
                capacity: request.capacity,
                rule: res.rule,
              });

              return request.reject({reason});
            }

            // Accept the channel open request
            return request.accept({});
          });

          return;
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
