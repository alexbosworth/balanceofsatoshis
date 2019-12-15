const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {getChannel} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const getMaximum = require('./get_maximum');
const isRoutePayable = require('./is_route_payable');

const accuracy = 1000;
const {isArray} = Array;
const from = 0;
const slowPaymentMs = 1000 * 30;
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
  }

  @returns via cbk or Promise
  {
    maximum: <Maximum Routeable Tokens Number>
  }
*/
module.exports = ({cltv, hops, lnd, logger, max}, cbk) => {
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
        return asyncMapSeries(hops, (hop, cbk) => {
          return getChannel({lnd, id: hop.channel}, (err, channel) => {
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

            return cbk(null, res.is_payable);
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'findMax'}, cbk));
  });
};
