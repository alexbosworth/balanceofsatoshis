const asyncAuto = require('async/auto');
const {createInvoice} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const encodeTrade = require('paid-services/trades/encode_trade');
const encryptTradeSecret = require('paid-services/trades/encrypt_trade_secret');

const asNumber = n => parseFloat(n, 10);
const utf8AsHex = utf8 => Buffer.from(utf8).toString('hex');

/** Create a new trade
  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
  }
  @returns via cbk or Promise
  {
    trade: <Hex Encoded Trade String>
  }
*/
module.exports = ({lnds, askForNodeId, askForDescription, askForSecret, askForPrice}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnds) {
          return cbk([400, 'ExpectedAuthenticatedLndToCreateTrade']);
        }

        return cbk();
      },


      // Encrypt the secret data
      encryptPayload: [
        'validate',
        ({}, cbk) =>
      {
        return encryptTradeSecret({
          lnd: lnds.lnd,
          secret: utf8AsHex(askForSecret),
          to: askForNodeId,
        },
        cbk);
      }],

      // Create the invoice to purchase the unlocking secret
      createPurchaseInvoice: [
        'encryptPayload',
        ({encryptPayload}, cbk) =>
      {
        return createInvoice({
          lnd: lnds.lnd,
          description: askForDescription.description,
          secret: encryptPayload.payment_secret,
          tokens: asNumber(askForPrice),
        },
        cbk);
      }],

      // Encode all the trade data into wire format
      encodeTradeToWireFormat: [
        'createPurchaseInvoice',
        'encryptPayload',
        ({createPurchaseInvoice, encryptPayload}, cbk) =>
      {
        try {
          const {trade} = encodeTrade({
            auth: encryptPayload.trade_auth_tag,
            payload: encryptPayload.trade_cipher,
            request: createPurchaseInvoice.request,
          });

          return cbk(null, {trade});
        } catch (err) {
          return cbk([500, err.message]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'encodeTradeToWireFormat'}, cbk));
  });
};