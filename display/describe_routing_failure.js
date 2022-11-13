const asyncAuto = require('async/auto');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const chartAliasForPeer = require('./chart_alias_for_peer');

const {isArray} = Array;

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
    [tagged]: [{
      icons: [<Icon String>]
      public_key: <Public Key Hex String>
    }]
  }

  @returns via cbk or Promise
  {
    description: <Failure Description String>
  }
*/
module.exports = ({index, lnd, reason, route, tagged}, cbk) => {
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

        if (!!tagged && !isArray(tagged)) {
          return cbk([400, 'ExpectedArrayOfTaggedNodesForFailureDescription']);
        }

        return cbk();
      },

      // Get source node alias
      getFrom: ['validate', ({}, cbk) => {
        const source = route.hops[index - [index].length];

        if (!source || !source.public_key) {
          return cbk();
        }

        return getNodeAlias({lnd, id: source.public_key}, cbk);
      }],

      // Get the destination node alias
      getTo: ['validate', ({}, cbk) => {
        const nextHop = route.hops[index];

        if (!nextHop || !nextHop.public_key) {
          return cbk();
        }

        return getNodeAlias({lnd, id: nextHop.public_key}, cbk);
      }],

      // Determine the from name
      fromName: ['getFrom', ({getFrom}, cbk) => {
        // Exit early when there is no known source
        if (!getFrom) {
          return cbk();
        }

        const tag = (tagged || []).find(n => n.public_key === getFrom.id);

        const {display} = chartAliasForPeer({
          alias: getFrom.alias,
          icons: !!tag ? tag.icons : undefined,
          public_key: getFrom.id,
        });

        return cbk(null, display);
      }],

      // Determine the to name
      toName: ['getTo', ({getTo}, cbk) => {
        // Exit early when there is no known destination
        if (!getTo) {
          return cbk();
        }

        const tag = (tagged || []).find(n => n.public_key === getTo.id);

        const {display} = chartAliasForPeer({
          alias: getTo.alias,
          public_key: getTo.id,
        });

        return cbk(null, display);
      }],

      // Describe the routing failure
      description: [
        'fromName',
        'toName',
        ({fromName, toName}, cbk) =>
      {
        const at = `on ${route.hops[index].channel}`;
        const from = !fromName ? '' : `from ${fromName}`;
        const to = !toName ? '' : ` forwarding to ${toName}`;

        return cbk(null, {description: `${reason} ${from} ${at}${to}`});
      }],
    },
    returnResult({reject, resolve, of: 'description'}, cbk));
  });
};
