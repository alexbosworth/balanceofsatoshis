const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {decodePaymentRequest} = require('ln-service');
const {getChannel} = require('ln-service');
const {getMaximum} = require('asyncjs-util');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const channelsFromHints = require('./channels_from_hints');
const isRoutePayable = require('./is_route_payable');

const accuracy = 10000;
const {isArray} = Array;
const from = 0;
const nextAttemptDelayMs = 1000 * 2;
const slowPaymentMs = 1000 * 60 * 4.5;
const to = tokens => tokens - Math.round(Math.random() * 1000);

/** Find max routable

  {
    cltv: <Final CLTV Delta Number>
    hops: [{
      channel: <Standard Format Channel Id String>
      public_key: <Forward to Public Key With Hex String>
    }]
    lnd: <Authenticated LND gRPC API Object>
    logger: <Winston Logger Object>
    max: <Max Attempt Tokens Number>
    [request]: <BOLT 11 Payment Request String>
  }

  @returns via cbk or Promise
  {
    maximum: <Maximum Routeable Tokens Number>
  }
*/
module.exports = ({cltv, hops, lnd, logger, max, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!cltv) {
          return cbk([400, 'ExpectedFinalCltvToFindMaxRoutable']);
        }

        if (!isArray(hops)) {
          return cbk([400, 'ExpectedArrayOfHopsToFindMaxRoutable']);
        }

        if (!!hops.find(({channel}) => !channel)) {
          return cbk([400, 'ExpectedChannelsInHopsToFindMaxRoutable']);
        }

        if (!!hops.find(n => !n.public_key)) {
          return cbk([400, 'ExpectedPublicKeyInHopsToFindMaxRoutable']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToFindMaxRoutableAmount']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToFindMaxRoutable']);
        }

        if (!max) {
          return cbk([400, 'ExpectedMaxLimitTokensToFindMaxRoutable']);
        }

        return cbk();
      },

      // Get channels
      channels: ['validate', ({}, cbk) => {
        const {channels} = channelsFromHints({request});

        return asyncMapSeries(hops, (hop, cbk) => {
          return getChannel({lnd, id: hop.channel}, (err, channel) => {
            // Avoid returning an error when channel is known from hops
            if (!!err && !!channels.find(n => n.id === hop.channel)) {
              return cbk(null, channels.find(n => n.id === hop.channel));
            }

            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {
              capacity: channel.capacity,
              destination: hop.public_key,
              id: hop.channel,
              policies: channel.policies,
            });
          });
        },
        cbk);
      }],

      // Find maximum
      findMax: ['channels', ({channels}, cbk) => {
        let isPayable = false;

        return getMaximum({accuracy, from, to: to(max)}, ({cursor}, cbk) => {
          const tokens = cursor;

          logger.info({evaluating_amount: cursor});

          const slowWarning = setTimeout(() => {
            logger.info({slow_path_timeout_in: '30 seconds'});
          },
          slowPaymentMs);

          return isRoutePayable({channels, cltv, lnd, tokens}, (err, res) => {
            clearTimeout(slowWarning);

            if (!!err) {
              return cbk(err);
            }

            if (!!res.is_payable) {
              isPayable = tokens;
            }

            return setTimeout(() => {
              return cbk(null, res.is_payable);
            },
            nextAttemptDelayMs);
          });
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          if (!isPayable) {
            return cbk([503, 'FailedToFindRoute']);
          }

          return cbk(null, res);
        });
      }],
    },
    returnResult({reject, resolve, of: 'findMax'}, cbk));
  });
};
