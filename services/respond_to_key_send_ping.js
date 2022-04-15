const asyncAuto = require('async/auto');
const {formatTokens} = require('ln-sync');
const {getNodeAlias} = require('ln-sync');
const {getPayment} = require('ln-service');
const {parsePaymentRequest} = require('ln-service');
const {payViaPaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const maximumPingPrice = 200;
const minimumPingPrice = 10;
const responsePingTokens = 1;
const tokensAsMillitokens = tok => (BigInt(tok) * BigInt(1e3)).toString();

/** Respond to a key send ping request

  {
    id: <Ping Invoice Id Hex String>
    lnd: <Server Authenticated LND API Object>
    logger: <Winston Logger Object>
    pay: <Payer Authenticated LND API Object>
    received: <Received Tokens Rounded Down Number>
    [request]: <BOLT 11 Encoded Payment Request String>
  }

  @returns via cbk or Promise
*/
module.exports = ({id, lnd, logger, pay, received, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!id) {
          return cbk([400, 'ExpectedInvoiceIdToRespondToKeySendPing']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToRespondToKeySendPing']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToRespondToKeySendPing']);
        }

        if (!pay) {
          return cbk([400, 'ExpectedPayerLndToRespondToKeySendPing']);
        }

        if (received === undefined) {
          return cbk([400, 'ExpectedReceivedAmountToRespondToKeySendPing']);
        }

        return cbk();
      },

      // Parse the payment request
      parseRequest: ['validate', ({}, cbk) => {
        // Exit early when there is no payment request
        if (!request) {
          return cbk();
        }

        try {
          return cbk(null, parsePaymentRequest({request}));
        } catch (err) {
          return cbk();
        }
      }],

      // Check on the request to see if it has been serviced
      getStatus: ['parseRequest', ({parseRequest}, cbk) => {
        // Exit early when there is no payment request to lookup
        if (!parseRequest) {
          return cbk();
        }

        return getPayment({id: parseRequest.id, lnd: pay}, (err, res) => {
          // Ignore errors on payment lookup
          if (!!err) {
            return cbk();
          }

          // Ignore past failed payments
          if (!!res.is_failed) {
            return cbk();
          }

          return cbk(null, res);
        });
      }],

      // Get the destination alias
      getAlias: [
        'parseRequest',
        'getStatus',
        ({parseRequest, getStatus}, cbk) =>
      {
        // Exit early when there is no destination
        if (!parseRequest) {
          return cbk()
        }

        // Exit early when the response is already in-progress
        if (!!getStatus) {
          return cbk();
        }

        return getNodeAlias({lnd, id: parseRequest.destination}, cbk);
      }],

      // Service the ping request with a pong back
      pong: [
        'getAlias',
        'getStatus',
        'parseRequest',
        ({getAlias, getStatus, parseRequest}, cbk) =>
      {
        // Exit early when there is a record of the response payment already
        if (!!getStatus) {
          return cbk();
        }

        // Exit early when there is no payment request
        if (!parseRequest) {
          logger.warn({received_bad_ping: 'MissingReturnPingRequest'});

          return cbk();
        }

        // Exit early when the payment request can't be returned
        if (!!parseRequest.is_expired) {
          return cbk();
        }

        // Exit early when the ping received amount is too low to respond
        if (received < minimumPingPrice) {
          logger.warn({received_bad_ping: 'PingReceiveAmountInsufficient'});

          return cbk();
        }

        // Exit early when the ping received amount is too high
        if (received > maximumPingPrice) {
          logger.warn({received_bad_ping: 'PingAmountGreaterThanExpected'});

          return cbk();
        }

        // Exit early when the response ping tokens are not as expected
        if (parseRequest.mtokens !== tokensAsMillitokens(responsePingTokens)) {
          logger.warn({received_bad_ping: 'PingResponseTokensValueIncorrect'});

          return cbk();
        }

        const feeBudget = received - responsePingTokens;

        return payViaPaymentRequest({
          request,
          lnd: pay,
          max_fee: received - responsePingTokens,
        },
        (err, res) => {
          if (!!err) {
            logger.warn({could_not_respond_to_ping: err});

            return cbk();
          }

          const tokens = received - res.tokens;

          logger.info({
            received_ping: id,
            sent_pong: res.id,
            sent_pong_to: `${getAlias.alias} ${getAlias.id}`.trim(),
            sent_at: new Date().toISOString(),
            earned: formatTokens({tokens}).display,
          });

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
