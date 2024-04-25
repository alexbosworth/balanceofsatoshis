const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {findKey} = require('ln-sync');
const {formatTokens} = require('ln-sync');
const {getChannels} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getSyntheticOutIgnores} = require('probing');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToMultiPathPay} = require('probing');
const {subscribeToMultiPathProbe} = require('probing');

const {describeRoute} = require('./../display');
const {describeRoutingFailure} = require('./../display');
const {getIgnores} = require('./../routing');
const {getTags} = require('./../tags');
const probeDestination = require('./probe_destination');

const cltvDeltaBuffer = 3;
const {isArray} = Array;
const mtokensAsTokens = mtokens => Number(mtokens / BigInt(1e3));
const pathTimeoutMs = 1000 * 60 * 5;
const singlePath = 1;

/** Make a payment

  {
    avoid: [<Avoid Forwarding Through String>]
    [fs]: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    [in_through]: <Pay In Through Node With Public Key Hex String>
    [is_strict_max_fee]: <Avoid Probing Too-High Fee Routes Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    max_fee: <Max Fee Tokens Number>
    max_paths: <Maximum Paths Number>
    [message]: <Message String>
    out: [<Out Through Peer With Public Key Hex String>]
    request: <BOLT 11 Payment Request String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.avoid)) {
          return cbk([400, 'ExpectedAvoidArrayToPayPaymentRequest']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToPayPaymentRequest']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToPayPaymentRequest']);
        }

        if (args.max_fee === undefined) {
          return cbk([400, 'ExpectedMaxFeeToleranceToPayPaymentRequest']);
        }

        if (!args.max_paths) {
          return cbk([400, 'ExpectedMaxPathsCountToPayPaymentRequest']);
        }

        if (!isArray(args.out)) {
          return cbk([400, 'ExpectedArrayOfOutPeersToStartProbe']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedBolt11PaymentRequestToPayPaymentRequest']);
        }

        try {
          parsePaymentRequest({request: args.request});
        } catch (err) {
          return cbk([400, 'ExpectedValidPaymentRequestToPay', {err}]);
        }

        if (parsePaymentRequest({request: args.request}).is_expired) {
          return cbk([400, 'PaymentRequestExpired']);
        }

        if (!BigInt(parsePaymentRequest({request: args.request}).mtokens)) {
          return cbk([400, 'UseSendToPayZeroAmountPaymentRequests']);
        }

        return cbk();
      },

      // Get channels for figuring out avoid flags
      getChannels: ['validate', ({}, cbk) => {
        // Exit early when there are no avoids
        if (!args.avoid.length) {
          return cbk();
        }

        return getChannels({lnd: args.lnd}, cbk);
      }],

      // Get the node public key
      getIdentity: ['validate', ({}, cbk) => {
        // Exit early when there are no avoids
        if (!args.avoid.length) {
          return cbk();
        }

        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Find public keys to pay out through
      getOuts: ['validate', ({}, cbk) => {
        return asyncMap(args.out, (query, cbk) => {
          return findKey({query, lnd: args.lnd}, cbk);
        },
        cbk);
      }],

      // Get tags for figuring out avoid flags
      getTags: ['validate', ({}, cbk) => {
        // Exit early when there are no avoids
        if (!args.avoid.length) {
          return cbk();
        }

        return getTags({fs: args.fs}, cbk);
      }],

      // Get base ignores
      getBaseIgnores: [
        'getChannels',
        'getIdentity',
        'getTags',
        ({getChannels, getIdentity, getTags}, cbk) =>
      {
        // Exit early when there are no avoids
        if (!args.avoid.length) {
          return cbk(null, {ignore: []});
        }

        const [out] = args.out || [];

        return getIgnores({
          avoid: args.avoid,
          channels: getChannels.channels,
          in_through: args.in_through,
          lnd: args.lnd,
          logger: args.logger,
          out_through: out,
          public_key: getIdentity.public_key,
          tags: getTags.tags,
        },
        cbk);
      }],

      // Get synthetic ignores to approximate out
      getIgnores: [
        'getBaseIgnores',
        'getOuts',
        ({getBaseIgnores, getOuts}, cbk) =>
      {
        // Exit early when not doing a multi-path
        if (args.max_paths === singlePath) {
          return cbk();
        }

        // Exit early when there is no outbound restriction
        if (!getOuts.length) {
          return cbk(null, {ignore: getBaseIgnores.ignore});
        }

        return getSyntheticOutIgnores({
          ignore: getBaseIgnores.ignore,
          lnd: args.lnd,
          out: getOuts.map(n => n.public_key),
        },
        cbk);
      }],

      // Make single-path payment
      singlePathPay: [
        'getBaseIgnores',
        'getOuts', ({getBaseIgnores, getOuts}, cbk) =>
      {
        // Exit early when doing a multi-path
        if (args.max_paths !== singlePath) {
          return cbk();
        }

        const [outThrough, otherKey] = getOuts.map(n => n.public_key);

        if (!!otherKey) {
          return cbk([501, 'CannotPayThroughMultipleOutPeersOnSinglePath']);
        }

        return probeDestination({
          fs: args.fs,
          ignore: getBaseIgnores.ignore,
          in_through: args.in_through,
          is_real_payment: true,
          is_strict_max_fee: args.is_strict_max_fee,
          logger: args.logger,
          lnd: args.lnd,
          max_fee: args.max_fee,
          message: args.message,
          out_through: outThrough,
          request: args.request,
        },
        cbk);
      }],

      // Get liquidity information for a multi path payment
      multiPathProbe: ['getIgnores', ({getIgnores}, cbk) => {
        // Exit early when doing a single path
        if (args.max_paths === singlePath) {
          return cbk();
        }

        if (!!args.is_strict_max_fee) {
          return cbk([501, 'StrictMaxFeeNotSupportedWithMultiPathPayments']);
        }

        if (!!args.message) {
          return cbk([501, 'MessageSendingNotSupportedWithMultiPathPayments']);
        }

        const paths = [];
        const request = parsePaymentRequest({request: args.request});

        const sub = subscribeToMultiPathProbe({
          cltv_delta: request.cltv_delta,
          destination: request.destination,
          features: request.features,
          ignore: getIgnores.ignore,
          incoming_peer: args.in_through,
          lnd: args.lnd,
          max_paths: args.max_paths,
          path_timeout_ms: pathTimeoutMs,
          routes: args.routes,
        });

        sub.on('error', err => cbk(err));

        sub.on('evaluating', ({tokens}) => {
          return args.logger.info({evaluating: tokens});
        });

        sub.on('failure', () => {
          return cbk([503, 'FailedToFindAnyPathsToDestination']);
        });

        sub.on('path', path => {
          paths.push(path);

          const liquidity = paths.reduce((m, n) => m + n.liquidity, Number());

          return args.logger.info({
            found_liquidity: formatTokens({tokens: liquidity}).display,
            found_paths: paths.length,
            requested_amount: formatTokens({tokens: request.tokens}).display,
          });
        });

        sub.on('probing', async ({route}) => {
          const {description} = await describeRoute({route, lnd: args.lnd});

          return args.logger.info({probing: description});
        });

        sub.on('routing_failure', async failure => {
          const {description} = await describeRoutingFailure({
            index: failure.index,
            lnd: args.lnd,
            reason: failure.reason,
            route: failure.route,
          });

          return args.logger.info({failure: description});
        });

        sub.on('success', ({paths}) => {
          const liquidity = paths.reduce((m, n) => m + n.liquidity, Number());

          if (request.tokens > liquidity) {
            return cbk([503, 'FailedToFindEnoughLiquidityOnPathsToPay']);
          }

          return cbk(null, {paths});
        });

        return;
      }],

      // Execute multi-path payment
      multiPathPay: ['multiPathProbe', ({multiPathProbe}, cbk) => {
        // Exit early when doing a single path
        if (args.max_paths === singlePath) {
          return cbk();
        }

        const request = parsePaymentRequest({request: args.request});

        // Check that the payment is not expired
        if (request.is_expired) {
          return cbk([400, 'PaymentRequestExpired']);
        }

        // Check that the destination supports multi-path
        if (!request.payment) {
          return cbk([400, 'PaymentDestinationDoesNotSupportMultiPath']);
        }

        const sub = subscribeToMultiPathPay({
          cltv_delta: request.cltv_delta + cltvDeltaBuffer,
          destination: request.destination,
          id: request.id,
          lnd: args.lnd,
          max_fee: args.max_fee,
          mtokens: request.mtokens,
          paths: multiPathProbe.paths,
          payment: request.payment,
          routes: request.routes,
        });

        sub.on('error', err => cbk(err));

        sub.on('failure', () => {
          return cbk([503, 'FailedToPayPaymentRequest']);
        });

        sub.on('paid', ({secret}) => args.logger.info({proof: secret}));

        sub.on('paying', async ({route}) => {
          const {description} = await describeRoute({route, lnd: args.lnd});

          return args.logger.info({
            amount: route.tokens,
            paying: description,
          });
        });

        sub.on('routing_failure', async ({index, reason, route}) => {
          if (reason === 'MppTimeout') {
            return;
          }

          const {description} = await describeRoutingFailure({
            index,
            reason,
            route,
            lnd: args.lnd,
          });

          return args.logger.info({failure: description});
        });

        sub.on('success', async ({routes}) => {
          const fees = routes
            .map(n => BigInt(n.fee_mtokens))
            .reduce((sum, n) => sum + n, BigInt(Number()));

          const paid = routes
            .map(n => BigInt(n.mtokens))
            .reduce((sum, n) => sum + n, BigInt(Number()));

          const feeTokens = mtokensAsTokens(fees);
          const paidTokens = mtokensAsTokens(paid);
          const [{secret}] = routes;

          const paths = await asyncMap(routes, async route => {
            const fee = formatTokens({tokens: route.fee}).display;
            const {description} = await describeRoute({route, lnd: args.lnd});

            return {
              path: description,
              fee: !!route.fee ? fee : undefined,
              paid: formatTokens({tokens: route.tokens}).display,
            };
          });

          const totalFees = formatTokens({tokens: feeTokens}).display;

          return cbk(null, {
            paths,
            payment_proof: secret,
            total_fees: !!feeTokens ? totalFees : undefined,
            total_paid: formatTokens({tokens: paidTokens}).display,
          });
        });

        return;
      }],

      // Final payment details
      payment: [
        'multiPathPay',
        'singlePathPay',
        ({multiPathPay, singlePathPay}, cbk) =>
      {
        return cbk(null, singlePathPay || multiPathPay);
      }],
    },
    returnResult({reject, resolve, of: 'payment'}, cbk));
  });
};
