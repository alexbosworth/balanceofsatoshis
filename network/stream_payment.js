const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const asyncMap = require('async/map');
const {formatTokens} = require('ln-sync');
const {getChannels} = require('ln-service');
const {getIdentity} = require('ln-service');
const {parseAmount} = require('ln-accounting');
const {returnResult} = require('asyncjs-util');
const {subscribeToStreamingPay} = require('probing');

const {describeRoute} = require('./../display');
const {getIcons} = require('./../display');
const {getIgnores} = require('./../routing');
const getOutChannels = require('./get_out_channels');
const getOutQueries = require('./get_out_queries');
const getPayTerms = require('./../lnurl/get_pay_terms');
const getStreamInvoice = require('./get_stream_invoice');
const getStreamRoute = require('./get_stream_route');
const {getTags} = require('./../tags');
const {minStreamPaymentTokens} = require('./constants');
const parseUrl = require('./../lnurl/parse_url');
const payStreamRoute = require('./pay_stream_route');

const asBtc = n => formatTokens({tokens: n}).display.trim() || (0).toFixed(8);
const feeRateForFee = (fee, tokens) => Math.floor(fee * 1e6 / tokens);
const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const {isInteger} = Number;
const isPositive = n => Number.isSafeInteger(n) && n > 0;
const {isSafeInteger} = Number;
const {max} = Math;
const maxUnusedRoutes = 3;
const {min} = Math;
const mtokensAsTokens = n => Number(BigInt(n) / BigInt(1e3));
const safeTokens = n => Number((BigInt(n) + BigInt(999)) / BigInt(1e3));
const tokensAsMtokens = tokens => (BigInt(tokens) * BigInt(1e3)).toString();

/** Stream a payment in a series of payments

  Streams to a `lnurl` for now, `out_filters` are checked before each payment

  {
    amount: <Total Amount To Pay String>
    avoid: [<Avoid Forwarding Through String>]
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    lnd: <Authenticated LND API Object>
    lnurl: <LNURL or Lightning Address String>
    logger: <Winston Logger Object>
    max_fee: <Max Total Fee Amount String>
    max_fee_rate: <Max Fee Rate Across All Payments Parts Per Million Number>
    [max_payment]: <Maximum Single Payment Amount String>
    [min_payment]: <Minimum Single Payment Amount String>
    out: [<Out Through Peer With Public Key, Alias, or Tag String>]
    [out_filters]: [<Out Through Peer Filter Formula String>]
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    payments: [{
      [fee]: <Fee Paid Tokens Display String>
      paid: <Paid Tokens Display String>
      path: [<Route Hop Description String>]
      proof: <Payment Preimage Hex String>
    }]
    [remaining]: <Amount Left To Stream Tokens Display String>
    [total_fee_rate]: <Total Fees Paid Per Million Paid String>
    [total_fees]: <Total Fees Paid Tokens Display String>
    total_paid: <Total Paid Tokens Display String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.amount) {
          return cbk([400, 'ExpectedAmountToStreamPayment']);
        }

        if (!isArray(args.avoid)) {
          return cbk([400, 'ExpectedAvoidArrayToStreamPayment']);
        }

        if (!args.fs) {
          return cbk([400, 'ExpectedFileSystemMethodsToStreamPayment']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToStreamPayment']);
        }

        if (!args.lnurl) {
          return cbk([400, 'ExpectedLnurlOrLightningAddressToStreamTo']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToStreamPayment']);
        }

        if (!args.max_fee) {
          return cbk([400, 'ExpectedMaxFeeToStreamPayment']);
        }

        if (!isInteger(args.max_fee_rate) || args.max_fee_rate < Number()) {
          return cbk([400, 'ExpectedMaxFeeRateToStreamPayment']);
        }

        if (!isArray(args.out)) {
          return cbk([400, 'ExpectedArrayOfOutPeersToStreamPayment']);
        }

        if (!!args.out_filters && !isArray(args.out_filters)) {
          return cbk([400, 'ExpectedArrayOfOutFiltersToStreamPayment']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToStreamPayment']);
        }

        return cbk();
      },

      // Parse the amount to pay
      tokens: ['validate', asyncify(() => {
        try {
          return parseAmount({amount: args.amount}).tokens;
        } catch (err) {
          throw [400, 'FailedToParseAmountToStreamPayment', {err}];
        }
      })],

      // Parse the maximum total fee
      maxFee: ['validate', asyncify(() => {
        try {
          return parseAmount({amount: args.max_fee}).tokens;
        } catch (err) {
          throw [400, 'FailedToParseMaxFeeToStreamPayment', {err}];
        }
      })],

      // Parse the maximum single payment amount
      maxPayment: ['validate', asyncify(() => {
        // Exit early when there is no maximum payment size
        if (args.max_payment === undefined) {
          return undefined;
        }

        try {
          return parseAmount({amount: args.max_payment}).tokens;
        } catch (err) {
          throw [400, 'FailedToParseMaxPaymentToStreamPayment', {err}];
        }
      })],

      // Parse the minimum single payment amount
      minPayment: ['validate', asyncify(() => {
        // Exit early when there is no minimum payment size
        if (args.min_payment === undefined) {
          return minStreamPaymentTokens;
        }

        try {
          return parseAmount({amount: args.min_payment}).tokens;
        } catch (err) {
          throw [400, 'FailedToParseMinPaymentToStreamPayment', {err}];
        }
      })],

      // Parse the lnurl into the url of the service
      url: ['validate', asyncify(() => {
        try {
          return parseUrl({url: args.lnurl}).url;
        } catch (err) {
          throw [400, 'ExpectedValidLnurlOrLightningAddress', {err}];
        }
      })],

      // Check the amounts before reaching out to the service or to LND
      checkAmounts: [
        'maxFee',
        'maxPayment',
        'minPayment',
        'tokens',
        ({maxFee, maxPayment, minPayment, tokens}, cbk) =>
      {
        if (!isInteger(maxFee) || maxFee < Number()) {
          return cbk([400, 'ExpectedNonNegativeMaxFeeToStreamPayment']);
        }

        if (!isPositive(tokens)) {
          return cbk([400, 'ExpectedPositiveAmountToStreamPayment']);
        }

        if (!isPositive(minPayment)) {
          return cbk([400, 'ExpectedPositiveMinPaymentToStreamPayment']);
        }

        // The amount must leave room for a minimum payment
        if (tokens < minPayment) {
          return cbk([400, 'ExpectedAmountAtLeastMinimumPayment', {
            minimum: minPayment,
          }]);
        }

        // Exit early when there is no maximum payment size
        if (maxPayment === undefined) {
          return cbk();
        }

        if (!isPositive(maxPayment)) {
          return cbk([400, 'ExpectedPositiveMaxPaymentToStreamPayment']);
        }

        // The max payment must leave room for a minimum payment
        if (maxPayment < minPayment) {
          return cbk([400, 'ExpectedMaxPaymentAtLeastMinPayment', {
            minimum: minPayment,
          }]);
        }

        return cbk();
      }],

      // Get channels for figuring out avoid flags
      getChannels: ['checkAmounts', ({}, cbk) => {
        return getChannels({lnd: args.lnd}, cbk);
      }],

      // Get the node public key for avoid flags
      getIdentity: ['checkAmounts', ({}, cbk) => {
        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Get tags for avoid flags, tags can also be avoided without avoid flags
      getTags: ['checkAmounts', ({}, cbk) => getTags({fs: args.fs}, cbk)],

      // Resolve out peer aliases to public keys once, out tags stay as tags
      getOutQueries: [
        'getChannels',
        'getTags',
        ({getChannels, getTags}, cbk) =>
      {
        return getOutQueries({
          channels: getChannels.channels,
          lnd: args.lnd,
          out: args.out,
          tags: getTags.tags,
        },
        cbk);
      }],

      // Find channels to pay out through, checking the out peers and filters
      getOuts: ['getOutQueries', ({getOutQueries}, cbk) => {
        return getOutChannels({
          filters: args.out_filters,
          fs: args.fs,
          lnd: args.lnd,
          out: getOutQueries.queries,
        },
        cbk);
      }],

      // Get the icons of tagged nodes to show in routes
      getIcons: ['checkAmounts', ({}, cbk) => getIcons({fs: args.fs}, cbk)],

      // Get the payment terms of the service
      getTerms: ['checkAmounts', 'url', ({url}, cbk) => {
        return getPayTerms({url, request: args.request}, cbk);
      }],

      // Get the ignores for avoids and for tags that are always avoided
      getIgnores: [
        'getChannels',
        'getIdentity',
        'getOutQueries',
        'getTags',
        ({getChannels, getIdentity, getOutQueries, getTags}, cbk) =>
      {
        const outs = getOutQueries.public_keys;

        // Out peers are never avoided for being in a tag that is avoided
        const avoided = flatten(getTags.tags
          .filter(n => !!n.is_avoided)
          .map(n => n.nodes))
          .filter(n => !outs.includes(n));

        return getIgnores({
          avoid: args.avoid.concat(avoided),
          channels: getChannels.channels,
          lnd: args.lnd,
          logger: args.logger,
          public_key: getIdentity.public_key,
          // Nodes of avoided tags are already in the avoids, less out peers
          tags: getTags.tags.map(tag => ({...tag, is_avoided: undefined})),
        },
        cbk);
      }],

      // The fee rate to use, the max fee is applied as a rate on the total
      maxFeeRate: [
        'checkAmounts',
        'maxFee',
        'tokens',
        ({maxFee, tokens}, cbk) =>
      {
        const rateForFee = feeRateForFee(maxFee, tokens);

        return cbk(null, min(args.max_fee_rate, rateForFee));
      }],

      // The smallest and largest single payments to make
      sizes: [
        'getTerms',
        'maxPayment',
        'minPayment',
        'tokens',
        ({getTerms, maxPayment, minPayment, tokens}, cbk) =>
      {
        // A service has to have limits that can be paid
        if (!isSafeInteger(getTerms.max) || !isSafeInteger(getTerms.min)) {
          return cbk([503, 'ExpectedSafeIntegerSendableLimitsFromService']);
        }

        // A payment is never smaller than what the service allows
        const minimum = max(minPayment, getTerms.min);

        if (tokens < minimum) {
          return cbk([400, 'ExpectedAmountAtLeastServiceMinSendable', {
            minimum,
          }]);
        }

        const hasMax = maxPayment !== undefined;

        // The max payment must leave room for a minimum payment of the service
        if (hasMax && maxPayment < minimum) {
          return cbk([400, 'ExpectedMaxPaymentAtLeastServiceMinSendable', {
            minimum,
          }]);
        }

        // The service advertised max must leave room for a minimum payment
        if (getTerms.max < minimum) {
          return cbk([400, 'ServiceMaxSendableBelowMinPayment', {
            minimum,
            max: getTerms.max,
          }]);
        }

        // A payment is never larger than the service advertises it allows
        const maximum = hasMax ? min(maxPayment, getTerms.max) : getTerms.max;

        return cbk(null, {
          max_mtokens: tokensAsMtokens(maximum),
          min_mtokens: tokensAsMtokens(minimum),
        });
      }],

      // Show what is being streamed, once out peers and avoids are known
      start: [
        'getIgnores',
        'getOuts',
        'getTerms',
        'maxFee',
        'maxFeeRate',
        'sizes',
        'tokens',
        ({getTerms, maxFee, maxFeeRate, sizes, tokens}, cbk) =>
      {
        const maxPayment = mtokensAsTokens(sizes.max_mtokens);
        const minPayment = mtokensAsTokens(sizes.min_mtokens);

        args.logger.info({
          description: getTerms.description,
          max_fee: asBtc(maxFee),
          max_fee_rate: maxFeeRate,
          max_payment: formatTokens({tokens: maxPayment}).display,
          min_payment: formatTokens({tokens: minPayment}).display,
          service_max_sendable: formatTokens({tokens: getTerms.max}).display,
          streaming: formatTokens({tokens}).display,
        });

        return cbk();
      }],

      // Stream the payment
      stream: [
        'getIcons',
        'getIgnores',
        'getOutQueries',
        'getOuts',
        'getTerms',
        'maxFeeRate',
        'sizes',
        'start',
        'tokens',
        ({
          getIcons,
          getIgnores,
          getOutQueries,
          getTerms,
          maxFeeRate,
          sizes,
          tokens,
        },
        cbk) =>
      {
        const attempts = [];
        const payments = [];
        let unusedRoutes = Number();

        const sub = subscribeToStreamingPay({
          lnd: args.lnd,
          max_fee_rate: maxFeeRate,
          max_shard_mtokens: sizes.max_mtokens,
          min_shard_mtokens: sizes.min_mtokens,
          mtokens: tokensAsMtokens(tokens),
        });

        // The stream ended before paying everything it could
        sub.once('error', err => cbk(null, {err, payments}));

        // The stream paid everything that it could
        sub.once('success', totals => cbk(null, {payments, totals}));

        // Show the amounts that routes are probed with
        sub.on('evaluating', ({tokens}) => {
          return args.logger.info({
            evaluating_amount: formatTokens({tokens}).display,
          });
        });

        // Show each payment that settled, as LND reports it
        sub.on('paid', payment => {
          const fee = safeTokens(payment.fee_mtokens);
          const sent = mtokensAsTokens(payment.mtokens);
          const tried = attempts.filter(n => n.id === payment.id);

          const [attempt] = tried.reverse();

          args.logger.info({
            fee: !fee ? undefined : formatTokens({tokens: fee}).display,
            paid: formatTokens({tokens: sent}).display,
            proof: payment.secret,
          });

          payments.push({...payment, route: attempt.route});

          return;
        });

        // Payments are made to invoices from the service
        sub.on('waiting_for_invoice', ({mtokens}, cbk) => {
          // An invoice is asked for when a route that was found is used
          unusedRoutes = Number();

          return getStreamInvoice({
            mtokens,
            hash: getTerms.hash,
            logger: args.logger,
            request: args.request,
            url: getTerms.url,
          },
          cbk);
        });

        // Payments are made over the routes that were found for them
        sub.on('waiting_for_payment', ({id, route}, cbk) => {
          attempts.push({id, route});

          // A payment is made when a route that was found is used
          unusedRoutes = Number();

          return payStreamRoute({
            id,
            route,
            lnd: args.lnd,
            logger: args.logger,
            tagged: getIcons.nodes,
          },
          cbk);
        });

        // Routes are found by probing for them
        sub.on('waiting_for_route', (target, cbk) => {
          // Exit early when the routes that were found keep going unused
          if (unusedRoutes === maxUnusedRoutes) {
            return cbk([503, 'FoundRoutesCouldNotCarryPayment']);
          }

          unusedRoutes++;

          return getStreamRoute({
            cltv_delta: target.cltv_delta,
            destination: target.destination,
            features: target.features,
            filters: args.out_filters,
            fs: args.fs,
            ignore: getIgnores.ignore,
            lnd: args.lnd,
            logger: args.logger,
            max_fee_mtokens: target.max_fee_mtokens,
            mtokens: target.mtokens,
            out: getOutQueries.queries,
            payment: target.payment,
            routes: target.routes,
            tagged: getIcons.nodes,
          },
          cbk);
        });

        return;
      }],

      // Describe the routes of the payments that were made
      getPaths: ['getIcons', 'stream', ({getIcons, stream}, cbk) => {
        return asyncMap(stream.payments, ({route}, cbk) => {
          return describeRoute({
            route,
            lnd: args.lnd,
            tagged: getIcons.nodes,
          },
          cbk);
        },
        cbk);
      }],

      // Summary of what was paid
      summary: [
        'getPaths',
        'stream',
        'tokens',
        ({getPaths, stream, tokens}, cbk) =>
      {
        const [,, details] = stream.err || [];

        const totals = stream.totals || details;

        const fees = safeTokens(totals.fee_mtokens);
        const feesMtokens = Number(totals.fee_mtokens);
        const paid = mtokensAsTokens(totals.mtokens);
        const paidMtokens = Number(totals.mtokens);

        const rate = feeRateForFee(feesMtokens, paidMtokens);
        const remaining = tokens - paid;

        // Each payment shows what it paid, the fee it paid, and its route
        const payments = stream.payments.map((payment, index) => {
          const fee = safeTokens(payment.fee_mtokens);
          const sent = mtokensAsTokens(payment.mtokens);

          return {
            fee: !fee ? undefined : formatTokens({tokens: fee}).display,
            paid: formatTokens({tokens: sent}).display,
            path: getPaths[index].description,
            proof: payment.secret,
          };
        });

        const left = formatTokens({tokens: remaining});

        return cbk(null, {
          payments,
          remaining: !remaining ? undefined : left.display,
          total_fee_rate: !fees ? undefined : String(rate),
          total_fees: !fees ? undefined : formatTokens({tokens: fees}).display,
          total_paid: formatTokens({tokens: paid}).display,
        });
      }],

      // Finish with what was paid, or with the error that ended the stream
      result: ['stream', 'summary', ({stream, summary}, cbk) => {
        // Exit early when the stream paid everything that it could
        if (!stream.err) {
          return cbk(null, summary);
        }

        // Show what was paid before the error, when anything was paid
        if (!!stream.payments.length) {
          args.logger.info(summary);
        }

        return cbk(stream.err);
      }],
    },
    returnResult({reject, resolve, of: 'result'}, cbk));
  });
};
