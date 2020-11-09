const asyncAuto = require('async/auto');
const {createInvoice} = require('ln-service');
const {formatTokens} = require('ln-sync');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');
const {subscribeToInvoice} = require('ln-service');

const {probeDestination} = require('./../network');

const description = '(bos) pong';
const {duration} = moment;
const expiration = () => moment().add(1, 'day').toISOString();
const {now} = Date;
const pingBackMessage = request => `(bos) Please ping me back at ${request}`;
const pingCost = 10;
const responsePingTokens = 1;
const typePing = '8470534167946609795';
const utf8AsHex = utf8 => Buffer.from(utf8).toString('hex');

/** Purchase a ping

  {
    destination: <Ping Destination Public Key Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
  {
    received_pong: <Received a Pong Bool>
    latency: <Descriptin of Time to Pong String>
    sent: <Amount Sent String>
    received_back: <Amount Received String>
    received_via: [<Received Via Channel Id String>]
    total_ping_cost: <Total Ping Cost String>
  }
*/
module.exports = ({destination, lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!destination) {
          return cbk([400, 'ExpectedDestinationToPurchasePing']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToPurchasePing']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToPurchasePing']);
        }

        return cbk();
      },

      // Create a pingback invoice
      createInvoice: ['validate', ({}, cbk) => {
        return createInvoice({
          description,
          lnd,
          expires_at: expiration(),
          tokens: responsePingTokens,
        },
        cbk);
      }],

      // Ping and then wait for a pong response
      ping: ['createInvoice', ({createInvoice}, cbk) => {
        const sub = subscribeToInvoice({lnd, id: createInvoice.id});

        sub.once('error', err => cbk(err));

        let payment;
        const {request} = createInvoice;
        const start = now();

        sub.on('invoice_updated', invoice => {
          // Exit early when the ping is expired
          if (!!invoice.is_canceled) {
            sub.removeAllListeners();

            return cbk([504, 'FailedToGetPongResponseInTime']);
          }

          // Exit early when the invoice has not been paid
          if (!invoice.is_confirmed) {
            return;
          }

          sub.removeAllListeners();

          const channels = invoice.payments.filter(n => !!n.is_confirmed);

          const cost = payment.paid - invoice.received;

          const [via, viaMore] = channels.map(n => n.in_channel);

          return cbk(null, {
            received_pong: true,
            latency_ms: now() - start,
            received_back: formatTokens({tokens: invoice.received}).display,
            received_via: !viaMore ? via : channels.map(n => n.in_channel),
            total_ping_cost: formatTokens({tokens: cost}).display,
          });
        });

        probeDestination({
          destination,
          lnd,
          logger,
          is_push: true,
          is_real_payment: true,
          max_fee: pingCost,
          message: pingBackMessage(request),
          messages: [{type: typePing, value: utf8AsHex(request)}],
          tokens: pingCost,
        },
        (err, res) => {
          if (!!err) {
            sub.removeAllListeners();

            return cbk(err);
          }

          logger.info({
            ping: res.id,
            sent: formatTokens({tokens: res.paid}).display,
          });

          payment = res;

          return;
        });
      }],
    },
    returnResult({reject, resolve, of: 'ping'}, cbk));
  });
};
