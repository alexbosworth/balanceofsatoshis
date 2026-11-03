const asyncAuto = require('async/auto');
const {formatTokens} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const {subscribeToPayViaRoutes} = require('ln-service');

const {describeRoute} = require('./../display');
const {describeRoutingFailure} = require('./../display');
const lineWriter = require('./line_writer');

const mtokensAsTokens = n => Number(BigInt(n) / BigInt(1e3));

/** Pay a route for a payment of a stream

  {
    id: <Payment Hash Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    route: <Route Object>
    [tagged]: [{
      icons: [<Icon String>]
      public_key: <Public Key Hex String>
    }]
  }

  @returns via cbk or Promise
*/
module.exports = ({id, lnd, logger, route, tagged}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!id) {
          return cbk([400, 'ExpectedPaymentHashToPayStreamRoute']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToPayStreamRoute']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToPayStreamRoute']);
        }

        if (!route) {
          return cbk([400, 'ExpectedRouteToPayStreamRoute']);
        }

        return cbk();
      },

      // Describe the route to show it
      describe: ['validate', ({}, cbk) => {
        return describeRoute({lnd, route, tagged}, cbk);
      }],

      // Pay the route
      pay: ['describe', ({describe}, cbk) => {
        const delivered = BigInt(route.mtokens) - BigInt(route.fee_mtokens);
        const lines = lineWriter({logger});
        const sub = subscribeToPayViaRoutes({id, lnd, routes: [route]});

        const amount = formatTokens({tokens: mtokensAsTokens(delivered)});

        logger.info({amount: amount.display, paying: describe.description});

        const finished = err => {
          sub.removeAllListeners();

          // Wait for lines that are being written so that they are not lost
          return lines.wait().then(() => cbk(err));
        };

        // The attempt is over, whether it settled or failed
        sub.once('end', () => finished());

        // Show why the payment could not be made
        sub.once('error', err => {
          const [, message] = err;

          lines.write(Promise.resolve({failure: message}));

          return finished(err);
        });

        // Show where the payment failed
        sub.on('routing_failure', failure => {
          const described = describeRoutingFailure({
            lnd,
            tagged,
            index: failure.index,
            reason: failure.reason,
            route: failure.route,
          });

          return lines.write(described.then(n => ({failure: n.description})));
        });

        return;
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
