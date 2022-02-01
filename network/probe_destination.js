const {createHash} = require('crypto');
const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const {decodePaymentRequest} = require('ln-service');
const {getChannels} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNode} = require('ln-service');
const moment = require('moment');
const {parsePaymentRequest} = require('invoices');
const {payViaRoutes} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {signBytes} = require('ln-service');
const {subscribeToFindMaxPayable} = require('probing');

const executeProbe = require('./execute_probe');
const {getIcons} = require('./../display');
const {sortBy} = require('./../arrays');

const bufFromHex = hex => Buffer.from(hex, 'hex');
const {ceil} = Math;
const cltvBuffer = 3;
const dateBytesLength = 8;
const datePrecisionLength = 6;
const dateType = '34349343';
const defaultCltvDelta = 144;
const defaultMaxFee = 1337;
const defaultTokens = 1;
const {floor} = Math;
const fromKeyType = '34349339';
const keySendPreimageType = '5482373484';
const makeNonce = () => randomBytes(32).toString('hex');
const {max} = Math;
const messageType = '34349334';
const {min} = Math;
const nodeKeyFamily = 6;
const preimageByteLength = 32;
const {now} = Date;
const rateDivisor = 1e6;
const reserveRatio = 0.01;
const signatureType = '34349337';
const tokAsMtok = tokens => (BigInt(tokens || 0) * BigInt(1e3)).toString();

/** Determine if a destination can be paid by probing it

  {
    [destination]: <Destination Public Key Hex String>
    [find_max]: <Find Maximum Payable On Probed Route Below Tokens Number>
    [fs]: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    [ignore]: [{
      from_public_key: <Avoid Node With Public Key Hex String>
      [to_public_key]: <Avoid Routing To Node With Public Key Hex String>
    }]
    [in_through]: <Pay In Through Public Key Hex String>
    [is_omitting_message_from]: <Omit Message From Fields Bool>
    [is_push]: <Is Push Payment Bool>
    [is_real_payment]: <Pay the Request after Probing Bool> // default: false
    [is_strict_max_fee]: <Avoid Probing Too-High Fee Routes Bool>
    lnd: <Authenticated LND gRPC API Object>
    logger: <Winston Logger Object>
    [max_fee]: <Maximum Fee Tokens Number>
    [max_fee_rate]: <Max Fee Rate Tokens Per Million Number>
    [message]: <Message String>
    [messages]: [{
      type: <Additional Message To Final Destination Type Number String>
      value: <Message To Final Destination Raw Value Hex Encoded String>
    }]
    [out_through]: <Out Through Peer With Public Key Hex String>
    [request]: <Payment Request String>
    [timeout_minutes]: <Stop Searching For Route After N Minutes Number>
    [tokens]: <Tokens Number>
  }

  @returns via cbk
  {
    [fee]: <Fee Tokens To Destination Number>
    [id]: <Payment Hash Hex String>
    [latency_ms]: <Latency Milliseconds Number>
    [route_maximum]: <Maximum Sendable Tokens On Successful Probe Path Number>
    [paid]: <Paid Tokens Number>
    [preimage]: <Payment HTLC Preimage Hex String>
    [relays]: [<Relaying Node Public Key Hex String]
    [success]: [<Standard Format Channel Id String>]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
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

      // Get node icons
      getIcons: ['validate', ({}, cbk) => {
        if (!args.fs) {
          return cbk();
        }

        return getIcons({fs: args.fs}, cbk);
      }],

      // Get identity key
      getIdentity: ['validate', ({}, cbk) => {
        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Destination to pay
      to: ['validate', ({}, cbk) => {
        // Exit early when sending a push payment
        if (!!args.is_push) {
          const secret = randomBytes(preimageByteLength);

          return cbk(null, {
            secret,
            destination: args.destination,
            id: createHash('sha256').update(secret).digest().toString('hex'),
            mtokens: !args.tokens ? '0': tokAsMtok(args.tokens),
          });
        }

        // Exit early when probing a destination
        if (!args.request && !!args.destination) {
          return cbk(null, {
            destination: args.destination,
            mtokens: !args.tokens ? '0': tokAsMtok(args.tokens),
            payment: makeNonce(),
            routes: [],
          });
        }

        if (!args.request) {
          return cbk([400, 'PayRequestOrDestinationRequiredToInitiateProbe']);
        }

        try {
          const details = parsePaymentRequest({request: args.request});

          if (details.is_expired) {
            return cbk([400, 'InvoiceIsExpired']);
          }

          // Exit early when tokens are specified for a request
          if (!!args.tokens) {
            return cbk(null, {
              cltv_delta: details.cltv_delta,
              destination: details.destination,
              features: details.features,
              id: details.id,
              mtokens: tokAsMtok(args.tokens),
              payment: details.payment,
              routes: details.routes,
              tokens: args.tokens,
            });
          }

          args.logger.info({
            description: details.description || undefined,
            destination: details.destination,
            expires: moment(details.expires_at).fromNow(),
            id: details.id,
            tokens: details.tokens,
          });

          return cbk(null, {
            cltv_delta: details.cltv_delta,
            destination: details.destination,
            features: details.features,
            id: details.id,
            mtokens: details.mtokens || '0',
            payment: details.payment,
            routes: details.routes,
            tokens: details.tokens,
          });
        } catch (err) {
          return cbk([400, 'FailedToDecodePaymentRequest', {err}]);
        }
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
        'getIdentity',
        'to',
        ({getDestinationNode, getIdentity, to}, cbk) =>
      {
        if (!!to.features) {
          return cbk(null, {features: to.features});
        }

        const features = getDestinationNode.features || [];

        // Only known features may be passed to find routes
        return cbk(null, {features: features.filter(n => !!n.is_known)});
      }],

      // Determine messages to attach
      messages: [
        'getFeatures',
        'getIdentity',
        'to',
        async ({getFeatures, getIdentity, to}, cbk) =>
      {
        // Exit early when there are no messages
        if (!args.message && !args.messages && !args.is_push) {
          return;
        }

        const date = Buffer.alloc(dateBytesLength);
        const messages = [].concat(args.messages || []);

        date.writeUIntBE(now(), Number(), datePrecisionLength);

        // Add message
        if (!!args.message) {
          messages.push({
            type: messageType,
            value: Buffer.from(args.message).toString('hex'),
          });
        }

        // Add message from fields
        if (!!args.message && !args.is_omitting_message_from) {
          messages.push({type: dateType, value: date.toString('hex')});
          messages.push({type: fromKeyType, value: getIdentity.public_key});

          const preimage = Buffer.concat([
            bufFromHex(getIdentity.public_key),
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
        'getIdentity',
        'to',
        ({getDestinationNode, getIdentity, to}, cbk) =>
      {
        const sendingTo = `${getDestinationNode.alias} ${to.destination}`;

        if (to.destination === getIdentity.public_key) {
          args.logger.info({circular_rebalance_for: sendingTo});
        } else {
          args.logger.info({checking_for_path_to: sendingTo});
        }

        return cbk();
      }],

      // Probe towards destination
      probe: [
        'getFeatures',
        'getIcons',
        'getIdentity',
        'messages',
        'outgoingChannelId',
        'to',
        ({getFeatures, getIcons, messages, outgoingChannelId, to}, cbk) =>
      {
        return executeProbe({
          messages,
          cltv_delta: (to.cltv_delta || defaultCltvDelta) + cltvBuffer,
          destination: to.destination,
          features: getFeatures.features,
          ignore: args.ignore,
          in_through: args.in_through,
          is_strict_max_fee: args.is_strict_max_fee,
          lnd: args.lnd,
          logger: args.logger,
          max_fee: args.max_fee,
          max_fee_rate: args.max_fee_rate || undefined,
          mtokens: !BigInt(to.mtokens) ? tokAsMtok(defaultTokens) : to.mtokens,
          outgoing_channel: outgoingChannelId,
          payment: to.payment,
          routes: to.routes,
          tagged: !!getIcons ? getIcons.nodes : undefined,
          timeout_minutes: args.timeout_minutes || undefined,
          total_mtokens: !!to.payment ? to.mtokens : undefined,
        },
        cbk);
      }],

      // Get maximum value of the successful route
      getMax: ['probe', 'to', ({probe, to}, cbk) => {
        if (!args.find_max || !probe.route) {
          return cbk(null, {});
        }

        const sub = subscribeToFindMaxPayable({
          cltv: (to.cltv_delta || defaultCltvDelta) + cltvBuffer,
          hops: probe.route.hops,
          lnd: args.lnd,
          max: args.find_max,
          request: args.request,
        });

        sub.on('evaluating', ({tokens}) => {
          return args.logger.info({evaluating_amount: tokens});
        });

        sub.once('error', err => cbk(err));

        // Did not find any higher value routes
        sub.once('failure', () => {
          return cbk(null, {maximum: min(args.find_max, probe.route.tokens)});
        });

        // Found a successful high value route
        sub.once('success', ({maximum}) => {
          return cbk(null, {
            maximum: min(args.find_max, max(maximum, probe.route.tokens)),
          });
        });

        return;
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

        const feeRate = ceil(probe.route.fee / probe.route.tokens * rateDivisor);

        if(args.max_fee_rate !== undefined && feeRate > args.max_fee_rate) {
          return cbk([400, 'MaxFeeRateTooLow', {needed_fee_rate: feeRate}]);
        }

        args.logger.info({
          paying: probe.route.hops.map(({channel}) => channel),
        });

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
          id: !pay ? undefined : pay.id,
          latency_ms: !route ? undefined : probe.latency_ms,
          route_maximum: getMax.maximum,
          paid: !pay ? undefined : pay.tokens,
          preimage: !pay ? undefined : pay.secret,
          probed: !!pay ? undefined : route.tokens - route.fee,
          relays: !route ? undefined : route.hops.map(n => n.public_key),
          success: !route ? undefined : route.hops.map(({channel}) => channel),
        });
      }],
    },
    returnResult({reject, resolve, of: 'outcome'}, cbk));
  });
};
