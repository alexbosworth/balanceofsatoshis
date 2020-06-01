const {createHash} = require('crypto');
const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const {decodePaymentRequest} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getRouteToDestination} = require('ln-service');
const {getRoutes} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {signBytes} = require('ln-service');

const {authenticatedLnd} = require('./../lnd');
const executeProbe = require('./execute_probe');
const {findMaxRoutable} = require('./../routing');
const {getInboundPath} = require('./../routing');
const {sortBy} = require('./../arrays');

const bufFromHex = hex => Buffer.from(hex, 'hex');
const cltvBuffer = 3;
const dateBytesLength = 8;
const datePrecisionLength = 6;
const dateType = '34349343';
const defaultCltvDelta = 144;
const defaultMaxFee = 1337;
const defaultTokens = 1;
const {floor} = Math;
const fromKeyType = '34349339';
const {isArray} = Array;
const keySendPreimageType = '5482373484';
const messageType = '34349334';
const nodeKeyFamily = 6;
const preimageByteLength = 32;
const {now} = Date;
const reserveRatio = 0.01;
const signatureType = '34349337';

/** Determine if a destination can be paid by probing it

  {
    [destination]: <Destination Public Key Hex String>
    [find_max]: <Find Maximum Payable On Probed Route Below Tokens Number>
    [ignore]: [{
      from_public_key: <Avoid Node With Public Key Hex String>
    }]
    [in_through]: <Pay In Through Public Key Hex String>
    [is_push]: <Is Push Payment Bool>
    [is_real_payment]: <Pay the Request after Probing Bool> // default: false
    [is_strict_max_fee]: <Avoid Probing Too-High Fee Routes Bool>
    lnd: <Authenticated LND gRPC API Object>
    logger: <Winston Logger Object>
    [max_fee]: <Maximum Fee Tokens Number>
    [message]: <Message String>
    [out_through]: <Out Through Peer With Public Key Hex String>
    [request]: <Payment Request String>
    [timeout_minutes]: <Stop Searching For Route After N Minutes Number>
    [tokens]: <Tokens Number>
  }

  @returns via cbk
  {
    [fee]: <Fee Tokens To Destination Number>
    [latency_ms]: <Latency Milliseconds Number>
    [route_maximum]: <Maximum Sendable Tokens On Successful Probe Path Number>
    [paid]: <Paid Tokens Number>
    [preimage]: <Payment HTLC Preimage Hex String>
    [relays]: [<Relaying Node Public Key Hex String]
    [success]: [<Standard Format Channel Id String>]
  }
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Check arguments
    validate: cbk => {
      if (!args.lnd) {
        return cbk([400, 'ExpectedLndToProbeDestination']);
      }

      if (!args.logger) {
        return cbk([400, "ExpectedLoggerToProbeDestination"]);
      }

      return cbk();
    },

    // Get channels to determine an outgoing channel id restriction
    getChannels: ['validate', ({}, cbk) => {
      // Exit early when there is no need to add an outgoing channel id
      if (!args.out_through) {
        return cbk();
      }

      return getChannels({lnd: args.lnd}, cbk);
    }],

    // Get height
    getInfo: ['validate', ({}, cbk) => getWalletInfo({lnd: args.lnd}, cbk)],

    // Destination to pay
    to: ['validate', ({}, cbk) => {
      if (!!args.is_push) {
        const secret = randomBytes(preimageByteLength);

        return cbk(null, {
          secret,
          destination: args.destination,
          id: createHash('sha256').update(secret).digest().toString('hex'),
        });
      }

      if (!args.request && !!args.destination) {
        return cbk(null, {destination: args.destination, routes: []});
      }

      if (!args.request) {
        return cbk([400, 'PayRequestOrDestinationRequiredToInitiateProbe']);
      }

      return decodePaymentRequest({lnd: args.lnd, request: args.request}, cbk);
    }],

    // Tokens
    tokens: ['to', ({to}, cbk) => {
      return cbk(null, args.tokens || to.tokens || defaultTokens);
    }],

    // Lookup node destination details
    getDestinationNode: ['to', ({to}, cbk) => {
      return getNode({
        is_omitting_channels: true,
        lnd: args.lnd,
        public_key: to.destination,
      },
      (err, res) => {
        // Suppress errors when the node is not found
        if (!!err) {
          return cbk(null, {alias: String()});
        }

        return cbk(null, res);
      });
    }],

    // Get the features of the node to probe
    getFeatures: [
      'getDestinationNode',
      'getInfo',
      'to',
      ({getDestinationNode, getInfo, to}, cbk) =>
    {
      if (!getInfo.features.length) {
        return cbk(null, {});
      }

      if (!!to.features) {
        return cbk(null, {features: to.features});
      }

      return cbk(null, getDestinationNode);
    }],

    // Determine messages to attach
    messages: [
      'getFeatures',
      'getInfo',
      'to',
      async ({getFeatures, getInfo, to}, cbk) =>
    {
      // Exit early when there are no messages
      if (!args.message && !args.is_push) {
        return;
      }

      if (!getInfo.features) {
        throw [400, 'SendingNodeDoesNotSupportSendingMessages'];
      }

      const date = Buffer.alloc(dateBytesLength);
      const messages = []

      date.writeUIntBE(now(), Number(), datePrecisionLength);

      if (!!args.message) {
        messages.push({type: dateType, value: date.toString('hex')});

        messages.push({
          type: messageType,
          value: Buffer.from(args.message).toString('hex'),
        });

        messages.push({type: fromKeyType, value: getInfo.public_key});

        const preimage = Buffer.concat([
          bufFromHex(getInfo.public_key),
          bufFromHex(to.destination),
          date,
          Buffer.from(args.message),
        ]);

        const {signature} = await signBytes({
          preimage: preimage.toString('hex'),
          key_family: nodeKeyFamily,
          key_index: Number(),
          lnd: args.lnd,
        });

        messages.push({type: signatureType, value: signature});
      }

      if (!!args.is_push) {
        messages.push({type: keySendPreimageType, value: to.secret});
      }

      return messages;
    }],

    // Get inbound path if an inbound restriction is specified
    getInboundPath: ['to', 'tokens', ({to, tokens}, cbk) => {
      if (!args.in_through) {
        return cbk();
      }

      return getInboundPath({
        tokens,
        destination: to.destination,
        lnd: args.lnd,
        through: args.in_through,
      },
      (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        return cbk(null, [res.path]);
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

      const withPeer = channels
        .filter(n => !!n.is_active)
        .filter(n => n.partner_public_key === outPeer);

      if (!withPeer.length) {
        return cbk([404, 'NoActiveChannelWithOutgoingPeer']);
      }

      const withBalance = withPeer.filter(n => {
        const reserve = n.local_reserve || floor(n.capacity * reserveRatio);

        return n.local_balance - tokens > reserve + n.commit_transaction_fee;
      });

      if (!withBalance.length) {
        return cbk([404, 'NoOutboundPeerWithSufficientBalance']);
      }

      const attribute = 'local_balance';

      const [channel] = sortBy({attribute, array: withBalance}).sorted;

      return cbk(null, channel.id);
    }],

    // Log sending towards destination
    checkPath: [
      'getDestinationNode',
      'getInfo',
      'to',
      ({getDestinationNode, getInfo, to}, cbk) =>
    {
      const sendingTo = `${getDestinationNode.alias} ${to.destination}`;

      if (to.destination === getInfo.public_key) {
        args.logger.info({circular_rebalance_for: sendingTo});
      } else {
        args.logger.info({checking_for_path_to: sendingTo});
      }

      return cbk();
    }],

    // Probe towards destination
    probe: [
      'getFeatures',
      'getInboundPath',
      'getInfo',
      'messages',
      'outgoingChannelId',
      'to',
      ({
        getInboundPath,
        getFeatures,
        getInfo,
        messages,
        outgoingChannelId,
        to,
      },
      cbk) =>
    {
      const inboundPath = !getInfo.features.length ? getInboundPath : null;

      return executeProbe({
        messages,
        cltv_delta: (to.cltv_delta || defaultCltvDelta) + cltvBuffer,
        destination: to.destination,
        features: getFeatures.features,
        ignore: args.ignore,
        in_through: args.in_through,
        is_strict_hints: !!getInboundPath,
        is_strict_max_fee: args.is_strict_max_fee,
        lnd: args.lnd,
        logger: args.logger,
        max_fee: args.max_fee,
        outgoing_channel: outgoingChannelId,
        payment: to.payment,
        routes: inboundPath || to.routes,
        timeout_minutes: args.timeout_minutes || undefined,
        tokens: args.tokens || to.tokens || defaultTokens,
        total_mtokens: !!to.payment ? to.mtokens : undefined,
      },
      cbk);
    }],

    // Get maximum value of the successful route
    getMax: ['probe', 'to', ({probe, to}, cbk) => {
      if (!args.find_max || !probe.route) {
        return cbk();
      }

      return findMaxRoutable({
        cltv: to.cltv_delta || defaultCltvDelta,
        hops: probe.route.hops,
        lnd: args.lnd,
        logger: args.logger,
        max: args.find_max,
        request: args.request,
      },
      cbk);
    }],

    // If there is a successful route, pay it
    pay: ['probe', 'to', ({probe, to}, cbk) => {
      if (!args.is_real_payment) {
        return cbk();
      }

      if (!probe.route) {
        return cbk();
      }

      if (args.max_fee !== undefined && probe.route.fee > args.max_fee) {
        return cbk([400, 'MaxFeeTooLow', {required_fee: probe.route.fee}]);
      }

      args.logger.info({paying: probe.route.hops.map(({channel}) => channel)});

      return payViaRoutes({
        id: to.id,
        lnd: args.lnd,
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
        route_maximum: !getMax ? undefined : getMax.maximum,
        paid: !pay ? undefined : pay.tokens,
        preimage: !pay ? undefined : pay.secret,
        probed: !!pay ? undefined : route.tokens - route.fee,
        relays: !route ? undefined : route.hops.map(n => n.public_key),
        success: !route ? undefined : route.hops.map(({channel}) => channel),
      });
    }],
  },
  returnResult({of: 'outcome'}, cbk));
};
