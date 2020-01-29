const asyncAuto = require('async/auto');
const asyncTimeout = require('async/timeout');
const {getRouteThroughHops} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {routeFromChannels} = require('ln-service');

const invalidCltvExpiry = 'IncorrectCltvExpiry';
const invalidPaymentMessage = 'UnknownPaymentHash';
const {isArray} = Array;
const mtokensFromTokens = tokens => (BigInt(tokens) * BigInt(1e3)).toString();
const pathfindingTimeoutMs = 1000 * 60;
const payWithTimeout = asyncTimeout(payViaRoutes, 1000 * 60);

/** Find out if route is payable

  {
    channels: [{
      capacity: <Maximum Tokens Number>
      destination: <Next Node Public Key Hex String>
      id: <Standard Format Channel Id String>
      policies: [{
        base_fee_mtokens: <Base Fee Millitokens String>
        cltv_delta: <Locktime Delta Number>
        fee_rate: <Fees Charged Per Million Tokens Number>
        is_disabled: <Channel Is Disabled Bool>
        min_htlc_mtokens: <Minimum HTLC Millitokens Value String>
        public_key: <Node Public Key String>
      }]
    }]
    cltv: <Final CLTV Delta Number>
    lnd: <Authenticated LND gRPC API Object>
    tokens: <Payable Tokens Number>
  }

  @returns via cbk or Promise
  {
    is_payable: <Route is Payable Bool>
  }
*/
module.exports = ({channels, cltv, lnd, tokens}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(channels)) {
          return cbk([400, 'ExpectedArrayOfChannelsToTestRoutePayable']);
        }

        if (!cltv) {
          return cbk([400, 'ExpectedFinalCltvDeltaToTestRoutePayable']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToTestRoutePayable']);
        }

        if (!tokens) {
          return cbk([400, 'ExpectedTokensToTestRoutePayable']);
        }

        return cbk();
      },

      // Get current height
      getHeight: cbk => getWalletInfo({lnd}, cbk),

      // Assemble route
      route: ['getHeight', ({getHeight}, cbk) => {
        const {route} = routeFromChannels({
          channels,
          cltv_delta: cltv,
          height: getHeight.current_block_height,
          mtokens: mtokensFromTokens(tokens),
        });

        return cbk(null, route);
      }],

      // Build a route
      getRoute: ['validate', ({}, cbk) => {
        return getRouteThroughHops({
          lnd,
          cltv_delta: cltv,
          mtokens: mtokensFromTokens(tokens),
          public_keys: channels.map(n => n.destination),
        },
        (err, res) => {
          // Exit early when there is an error and use local route calculation
          if (!!err) {
            return cbk();
          }

          return cbk(null, res.route);
        });
      }],

      // Attempt the route
      attempt: ['getRoute', 'route', ({getRoute, route}, cbk) => {
        return payWithTimeout({
          lnd,
          pathfinding_timeout: pathfindingTimeoutMs,
          routes: [getRoute || route],
        },
        err => {
          if (!!err && !isArray(err)) {
            return cbk(null, {is_payable: false});
          }

          const [, code] = err;

          if (code === invalidCltvExpiry) {
            return cbk([503, 'UnexpectedErrorCode', {err}]);
          }

          return cbk(null, {is_payable: code === invalidPaymentMessage});
        });
      }],
    },
    returnResult({reject, resolve, of: 'attempt'}, cbk));
  });
};
