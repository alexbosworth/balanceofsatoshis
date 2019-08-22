const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {decodePaymentRequest} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getRoutes} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {probeForRoute} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToProbe} = require('ln-service');

const {authenticatedLnd} = require('./../lnd');
const getMaximum = require('./get_maximum');

const defaultCltvDelta = 144;
const defaultTokens = 10;
const {isArray} = Array;
const maxCltvDelta = 144 * 30;
const {now} = Date;

/** Determine if a destination can be paid by probing it

  {
    [destination]: <Destination Public Key Hex String>
    [find_max]: <Find Maximum Payable Below Tokens Number>
    [in_through]: <Pay In Through Public Key Hex String>
    [is_real_payment]: <Pay the Request after Probing Bool> // default: false
    logger: <Winston Logger Object>
    [max_fee]: <Maximum Fee Tokens Number>
    [node]: <Node Name String>
    [out_through]: <Out through peer with Public Key Hex String>
    request: <Payment Request String>
    [tokens]: <Tokens Number>
  }

  @returns via cbk
  {
    [fee]: <Fee Tokens To Destination Number>
    [latency_ms]: <Latency Milliseconds Number>
    [success]: [<Standard Format Channel Id String>]
  }
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Lnd
    getLnd: cbk => authenticatedLnd({node: args.node}, cbk),

    // Get height
    getHeight: ['getLnd', ({getLnd}, cbk) => {
      return getWalletInfo({lnd: getLnd.lnd}, cbk);
    }],

    // Destination to pay
    to: ['getLnd', ({getLnd}, cbk) => {
      if (!!args.destination) {
        return cbk(null, {destination: args.destination, routes: []});
      }

      return decodePaymentRequest({
        lnd: getLnd.lnd,
        request: args.request,
      },
      cbk);
    }],

    // Get channels to determine an outgoing channel id restriction
    getChannels: ['getLnd', ({getLnd}, cbk) => {
      // Exit early when there is no need to add an outgoing channel id
      if (!args.out_through) {
        return cbk();
      }

      return getChannels({is_active: true, lnd: getLnd.lnd}, cbk);
    }],

    // Get inbound path if an inbound restriction is specified
    getInboundPath: ['getLnd', 'to', ({getLnd, to}, cbk) => {
      if (!args.in_through) {
        return cbk();
      }

      const inThrough = args.in_through;

      return getNode({
        lnd: getLnd.lnd,
        public_key: to.destination,
      },
      (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        const connectingChannels = (res.channels || [])
          .filter(n => !!n.policies.find(n => n.public_key === inThrough));

        if (!connectingChannels.length) {
          return cbk([400, 'NoConnectingChannelToPayIn']);
        }

        const [channel] = connectingChannels
          .filter(n => n.capacity > args.tokens || to.tokens || defaultTokens);

        if (!channel) {
          return cbk([400, 'NoSufficientCapacityConnectingChannelToPayIn']);
        }

        const policy = channel.policies.find(n => n.public_key !== inThrough);

        const path = [
          {
            public_key: inThrough,
          },
          {
            base_fee_mtokens: policy.base_fee_mtokens,
            channel: channel.id,
            channel_capacity: channel.capacity,
            cltv_delta: policy.cltv_delta,
            fee_rate: policy.fee_rate,
            public_key: to.destination,
          },
        ];

        return cbk(null, [path]);
      });
    }],

    // Outgoing channel id
    outgoingChannelId: ['getChannels', 'to', ({getChannels, to}, cbk) => {
      if (!getChannels) {
        return cbk();
      }

      const {channels} = getChannels;
      const outPeer = args.out_through;
      const tokens = args.tokens || to.tokens || defaultTokens;

      const withPeer = channels.filter(n => n.partner_public_key == outPeer);

      if (!withPeer.length) {
        return cbk([404, 'NoActiveChannelWithChosenPeer']);
      }

      const withBalance = withPeer
        .filter(n => tokens < n.local_balance - (n.local_reserve || 0));

      if (!withBalance.length) {
        return cbk([404, 'NoChannelWithSufficientBalance']);
      }

      const [channel] = withBalance
        .sort((a, b) => a.local_balance < b.local_balance ? -1 : 1);

      return cbk(null, channel.id);
    }],

    // Check that there is a potential path
    checkPath: [
      'getInboundPath',
      'getLnd',
      'outgoingChannelId',
      'to',
      ({getInboundPath, getLnd, outgoingChannelId, to}, cbk) =>
    {
      return getRoutes({
        cltv_delta: to.cltv_delta,
        destination: to.destination,
        is_adjusted_for_past_failures: true,
        is_strict_hints: !!getInboundPath,
        lnd: getLnd.lnd,
        outgoing_channel: outgoingChannelId,
        routes: getInboundPath || to.routes,
        tokens: args.tokens || to.tokens || defaultTokens,
      },
      (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        if (!res.routes.length) {
          return cbk([404, 'FailedToFindPathToDestination']);
        }

        return cbk();
      });
    }],

    // Probe towards destination
    probe: [
      'getHeight',
      'getInboundPath',
      'getLnd',
      'outgoingChannelId',
      'to',
      ({getHeight, getInboundPath, getLnd, outgoingChannelId, to}, cbk) =>
    {
      const attemptedPaths = [];
      let success;
      const start = now();

      const sub = subscribeToProbe({
        cltv_delta: to.cltv_delta || defaultCltvDelta,
        destination: to.destination,
        is_strict_hints: !!getInboundPath,
        lnd: getLnd.lnd,
        max_timeout_height: getHeight.current_block_height + maxCltvDelta,
        outgoing_channel: outgoingChannelId,
        path_timeout_ms: 1000 * 30,
        routes: getInboundPath || to.routes,
        tokens: args.tokens || to.tokens || defaultTokens,
      });

      sub.on('end', () => {
        const latencyMs = now() - start;

        if (!success) {
          return cbk(null, {attempted_paths: attemptedPaths.length});
        }

        if (!!args.max_fee && success.fee > args.max_fee) {
          return cbk([400, 'MaxFeeLimitTooLow', {needed_fee: success.fee}]);
        }

        return cbk(null, {latency_ms: latencyMs, route: success});
      });

      sub.on('error', err => args.logger.error(err));

      sub.on('routing_failure', fail => {
        return args.logger.info({
          failure: `${fail.reason} at ${fail.channel || fail.public_key}`,
        });
      });

      sub.on('probe_success', ({route}) => success = route);

      sub.on('probing', ({route}) => {
        attemptedPaths.push(route);

        return asyncMapSeries(route.hops, (hop, cbk) => {
          return getNode({
            lnd: getLnd.lnd,
            public_key: hop.public_key,
          },
          (err, node) => {
            const alias = (!!err || !node || !node.alias) ? '' : node.alias;

            return cbk(null, `${hop.channel} ${alias} ${hop.public_key}`);
          });
        },
        (err, checking) => {
          if (!!err) {
            return args.logger.error(err);
          }

          return args.logger.info({checking});
        });
      });

      return;
    }],

    // Get maximum value
    getMax: [
      'getHeight',
      'getInboundPath',
      'getLnd',
      'outgoingChannelId',
      'probe',
      'to',
      ({getHeight, getInboundPath, getLnd, outgoingChannelId, probe, to}, cbk) =>
    {
      if (!args.find_max || !probe.route) {
        return cbk();
      }

      return getMaximum({
        accuracy: 1000,
        from: defaultTokens,
        to: args.find_max + Math.round(Math.random() * 1000),
      },
      ({cursor}, cbk) => {
        args.logger.info({attempting: cursor});

        return probeForRoute({
          cltv_delta: to.cltv_delta,
          destination: to.destination,
          is_strict_hints: !!getInboundPath,
          lnd: getLnd.lnd,
          max_timeout_height: getHeight.current_block_height + maxCltvDelta,
          outgoing_channel: outgoingChannelId,
          path_timeout_ms: 1000 * 30,
          routes: getInboundPath || to.routes,
          tokens: cursor,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, !!res.route);
        });
      },
      cbk);
    }],

    // If there is a successful route, pay it
    pay: ['getLnd', 'probe', 'to', ({getLnd, probe, to}, cbk) => {
      if (!args.is_real_payment) {
        return cbk();
      }

      if (!probe.route) {
        return cbk();
      }

      if (args.max_fee !== undefined && probe.route.fee > args.max_fee) {
        return cbk([400, 'MaxFeeTooLow', {required_fee: probe.route.fee}]);
      }

      return payViaRoutes({
        id: to.id,
        lnd: getLnd.lnd,
        routes: [probe.route],
      },
      cbk);
    }],

    // Outcome of probes and payment
    outcome: ['getMax', 'pay', 'probe', ({getMax, pay, probe}, cbk) => {
      if (!probe.route) {
        return cbk(null, {attempted_paths: probe.attempted_paths});
      }

      const {route} = probe;

      return cbk(null, {
        fee: !route ? undefined : route.fee,
        latency_ms: !route ? undefined : probe.latency_ms,
        maximum_payable: !getMax ? undefined : getMax.maximum,
        paid: !pay ? undefined : pay.tokens,
        preimage: !pay ? undefined : pay.secret,
        probed: !!pay ? undefined : route.tokens - route.fee,
        success: !route ? undefined : route.hops.map(({channel}) => channel),
      });
    }],
  },
  returnResult({of: 'outcome'}, cbk));
};
