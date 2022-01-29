const asyncAuto = require('async/auto');
const {enforceForwardRequestRules} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const disableAllForwards = 0;
const hoursAsSeconds = hours => hours * 60 * 60;

/** Limit forwarding requests

  {
    lnd: (await lndForNode(logger, options.node)).lnd,
    logger: <Winston Logger Object>
    [is_disabling_all_forwards]: <All Forwards Are Disabled Bool>
    [max_hours_since_last_block]: options.maxHoursSinceLastBlock,
    [max_new_pending_per_hour]: options.maxNewPendingPerHour,
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
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

      // Limit forward requests
      limit: [
        'maxPendingPerHour',
        'maxSecondsSinceLastBlock',
        ({maxPendingPerHour, maxSecondsSinceLastBlock}, cbk) =>
      {
        args.logger.info({limiting_forwards: true});

        const sub = enforceForwardRequestRules({
          lnd: args.lnd,
          max_new_pending_per_hour: maxPendingPerHour,
          max_seconds_since_last_block: maxSecondsSinceLastBlock,
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
