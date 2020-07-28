const asyncAuto = require('async/auto');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');

/** Get a description for a routing failure

  {
    index: <Failure Index Number>
    lnd: <Authenticated LND API Object>
    reason: <Failure Reason Code String>
    route: {
      hops: [{
        channel: <Standard Format Channel Id String>
        public_key: <Public Key Hex String>
      }]
    }
  }

  @returns via cbk or Promise
  {
    description: <Failure Description String>
  }
*/
module.exports = ({index, lnd, reason, route}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (index === undefined) {
          return cbk([400, 'ExpectedIndexToDescribeRoutingFailure']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndApiObjectToDescribeRoutingFailure']);
        }

        if (!reason) {
          return cbk([400, 'ExpectedFailureReasonToDescribeRoutingFailure']);
        }

        if (!route) {
          return cbk([400, 'ExpectedFailedRouteToDescribeRoutingFailure']);
        }

        return cbk();
      },

      // Get node alias
      getAlias: ['validate', ({}, cbk) => {
        const source = route.hops[index - [index].length];

        if (!source) {
          return cbk();
        }

        return getNode({
          lnd,
          is_omitting_channels: true,
          public_key: source.public_key,
        },
        (err, res) => {
          if (!!err) {
            return cbk(null, source.public_key);
          }

          return cbk(null, res.alias || source.public_key);
        });
      }],

      // Describe the routing failure
      description: ['getAlias', ({getAlias}, cbk) => {
        const at = `at ${route.hops[index].channel}`;
        const from = !getAlias ? '' : `from ${getAlias}`;

        return cbk(null, {description: `${reason} ${at} ${from}`});
      }],
    },
    returnResult({reject, resolve, of: 'description'}, cbk));
  });
};
