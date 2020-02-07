const asyncAuto = require('async/auto');
const {encode} = require('cbor');
const {returnResult} = require('asyncjs-util');
const {swapUserId} = require('goldengate');

const decodeSwapApiKey = require('./decode_swap_api_key');
const getPaidService = require('./get_paid_service');

/** Purchase or inspect a swap API key

  {
    [api_key]: <Swap CBOR Encoded API Key Hex String>
    [is_purchase]: <Purchase a New API Key Bool>
    [macaroon]: <Macaroon Hex Encoded String>
    [lnd]: <Authenticated LND API gRPC API Object>
    [logger]: <Winston Logger Object>
    [preimage]: <Preimage Hex String>
  }

  @returns via cbk or Promise
  {
    api_key: <CBOR API Key Hex Encoded String>
    swap_user_id: <Authenticated User Id String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.api_key && !args.is_purchase && !args.macaroon) {
          return cbk([400, 'ExpectedPurchaseOrApiKeyDetailsToView']);
        }

        if (!!args.api_key && !!args.is_purchase) {
          return cbk([400, 'PurchaseNotNeededWhenApiKeyProvided']);
        }

        if (!!args.api_key && !!args.macaroon) {
          return cbk([400, 'MacaroonNotNeededWhenApiKeyProvided']);
        }

        if (!!args.api_key && !!args.preimage) {
          return cbk([400, 'PreimageNotNeededWhenApiKeyProvided']);
        }

        if (!!args.is_purchase && !args.lnd) {
          return cbk([400, 'ExpectedLndWhenPurchaseIsRequested']);
        }

        if (!!args.is_purchase && !args.logger) {
          return cbk([400,'ExpectedLoggerWhenPurchaseIsRequested']);
        }

        if (!!args.is_purchase && !!args.macaroon) {
          return cbk([400, 'PurchaseNotNeededWhenMacaroonProvided']);
        }

        if (!!args.is_purchase && !!args.preimage) {
          return cbk([400, 'PurchaseNotNeededWhenPreimageProvided']);
        }

        return cbk();
      },

      // Derive the key from the macaroon and preimage
      apiKey: ['validate', ({}, cbk) => {
        // Exit early when the macaroon is not supplied
        if (!args.macaroon) {
          return cbk();
        }

        const macaroon = Buffer.from(args.macaroon, 'hex');
        const preimage = Buffer.from(args.preimage, 'hex');

        return cbk(null, {
          api_key: encode({macaroon, preimage}).toString('hex'),
          id: swapUserId({macaroon: macaroon.toString('base64')}),
        });
      }],

      // Get API token
      getApiKey: ['validate', ({}, cbk) => {
        // Exit early when there is no existing API token and no purchase
        if (!args.api_key && !args.is_purchase) {
          return cbk();
        }

        return getPaidService({
          lnd: args.lnd,
          logger: args.logger,
          token: args.api_key,
        },
        cbk);
      }],

      // Swap API Key
      key: ['apiKey', 'getApiKey', ({apiKey, getApiKey}, cbk) => {
        if (!!apiKey) {
          return cbk(null, {
            api_key: apiKey.api_key,
            swap_user_id: apiKey.id,
          });
        }

        return cbk(null, {
          api_key: getApiKey.token,
          paid: getApiKey.paid || undefined,
          swap_user_id: getApiKey.id,
        });
      }],
    },
    returnResult({reject, resolve, of: 'key'}, cbk));
  });
};
