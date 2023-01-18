const asyncAuto = require('async/auto');
const {enforceForwardRequestRules} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const disableAllForwards = 0;
const hoursAsSeconds = hours => hours * 60 * 60;
const {isArray} = Array;
const isEdge = n => !!n && /^[0-9A-F]{66}\/[0-9A-F]{66}$/i.test(n);
const splitEdge = n => n.split('/');

/** Limit forwarding requests

  {
    lnd: (await lndForNode(logger, options.node)).lnd,
    logger: <Winston Logger Object>
    [is_disabling_all_forwards]: <All Forwards Are Disabled Bool>
    [max_hours_since_last_block]: <Maximum Hours Since Last Block Number>
    [max_new_pending_per_hour]: <Maximum Outstanding New HTLCs Per Hour Number>
    [min_channel_confirmations]: <Minimum Required Channel Confs Number>
    only_allow: [<In Public Key / Out Public Key String>]
    only_disallow: [<In Public Key/ Out Public Key String>]
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.only_allow)) {
          return cbk([400, 'ExpectedOnlyAllowArrayToLimitForwarding']);
        }

        if (!isArray(args.only_disallow)) {
          return cbk([400, 'ExpectedOnlyDisallowArrayToLimitForwarding']);
        }

        if (!!args.only_allow.length && !!args.only_disallow.length) {
          return cbk([400, 'ExpectedEitherAllowOrDisallowPublicKeyPairs']);
        }
        
        if (!!args.only_allow.filter(n => !isEdge(n)).length) {
          return cbk([400, 'ExpectedOnlyAllowAsPublicKeyPairs']);
        }

        if (!!args.only_disallow.filter(n => !isEdge(n)).length) {
          return cbk([400, 'ExpectedOnlyDisallowAsPublicKeyPairs']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToLimitForwarding']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToLimitForwarding']);
        }

        return cbk();
      },

      // Max pending per hour
      maxPendingPerHour: ['validate', ({}, cbk) => {
        if (!!args.is_disabling_all_forwards) {
          return cbk(null, disableAllForwards);
        }

        if (!!args.max_new_pending_per_hour) {
          return cbk(null, args.max_new_pending_per_hour);
        }

        return cbk();
      }],

      // Max seconds allowed since the last block
      maxSecondsSinceLastBlock: ['validate', ({}, cbk) => {
        if (!args.max_hours_since_last_block) {
          return cbk();
        }

        return cbk(null, hoursAsSeconds(args.max_hours_since_last_block));
      }],

      // Only allow pairs
      onlyAllow: ['validate', ({}, cbk) => {
        if (!args.only_allow.length) {
          return cbk();
        }

        const allow = args.only_allow.map(splitEdge).map(([inKey, outKey]) => {
          return {inbound_peer: inKey, outbound_peer: outKey};
        });

        return cbk(null, allow);
      }],

      // Only disallow pairs
      onlyDisallow: ['validate', ({}, cbk) => {
        if (!args.only_disallow.length) {
          return cbk();
        }

        const disallow = args.only_disallow.map(splitEdge).map(([inKey, outKey]) => {
          return {inbound_peer: inKey, outbound_peer: outKey};
        });

        return cbk(null, disallow);
      }],

      // Limit forward requests
      limit: [
        'maxPendingPerHour',
        'maxSecondsSinceLastBlock',
        'onlyAllow',
        'onlyDisallow',
        ({maxPendingPerHour, maxSecondsSinceLastBlock, onlyAllow, onlyDisallow}, cbk) =>
      {
        args.logger.info({limiting_forwards: true});

        const sub = enforceForwardRequestRules({
          lnd: args.lnd,
          max_new_pending_per_hour: maxPendingPerHour,
          max_seconds_since_last_block: maxSecondsSinceLastBlock,
          min_activation_age: args.min_channel_confirmations || undefined,
          only_allow: onlyAllow,
          only_disallow: onlyDisallow,
        });

        sub.on('error', err => {
          return cbk([503, 'UnexpectedErrorLimitingForwarding', {err}]);
        });

        sub.on('rejected', async rejected => {
          const forward = `${rejected.in_channel} → ${rejected.out_channel}`;

          const rejection = `${rejected.reject_reason} ${forward}`;

          return args.logger.info({rejection});
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
