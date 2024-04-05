const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {sendMessageToPeer} = require('ln-service');

const {codeInvalidParameters} = require('./lsps1_protocol');
const {defaultChannelActiveConfs} = require('./constants');
const {defaultLifetimeBlocks} = require('./constants');
const {errMessageInvalidParams} = require('./lsps1_protocol');
const {typeForMessaging} = require('./lsps1_protocol');
const {versionJsonRpc} = require('./lsps1_protocol');

const decodeMessage = hex => JSON.parse(Buffer.from(hex, 'hex').toString());
const encodeMessage = obj => Buffer.from(JSON.stringify(obj)).toString('hex');

/** Send general terms for the channel open service

  {
    max_capacity: <Maximum Supported Channel Capacity Tokens Number>
    message: <Received Message Hex String>
    min_capacity: <Minimum Supported Channel Capacity Tokens Number>
    lnd: <Authenticated LND API Object>
    to_peer: <Peer Public Key Hex String>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.max_capacity) {
          return cbk([400, 'ExpectedMaxCapacityToSendLsps1InfoMessage']);
        }

        if (!args.message) {
          return cbk([400, 'ExpectedMessageToSendLsps1InfoMessage']);
        }

        try {
          decodeMessage(args.message);
        } catch (e) {
          return cbk([400, 'ExpectedValidMessageToSendLsps1InfoMessage']);
        }

        if (!args.min_capacity) {
          return cbk([400, 'ExpectedMinCapacityToSendLsps1InfoMessage']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToSendLsps1InfoMessage']);
        }

        if (!args.to_peer) {
          return cbk([400, 'ExpectedIdentityPubKeyToSendLsps1InfoMessage']);
        }

        return cbk();
      },

      // Make the terms response
      response: ['validate', ({}, cbk) => {
        const {id, params} = decodeMessage(args.message);

        // A response cannot be returned when there is no request id
        if (!id) {
          return cbk([400, 'ExpectedMessageIdToSendLsps1ChannelOpenInfo']);
        }

        // Exit early when params are missing
        if (!params) {
          return cbk(null, {
            id,
            error: {
              code: codeInvalidParameters,
              data: {
                message: 'MissingParamsInGetInfoRequest',
                property: 'params',
              },
              message: errMessageInvalidParams,
            },
          });
        }

        return cbk(null, {
          id,
          result: {
            options: {
              max_channel_balance_sat: args.max_capacity.toString(),
              max_channel_expiry_blocks: defaultLifetimeBlocks,
              max_initial_client_balance_sat: Number().toString(),
              max_initial_lsp_balance_sat: args.max_capacity.toString(),
              min_channel_balance_sat: args.min_capacity.toString(),
              min_channel_confirmations: defaultChannelActiveConfs,
              min_initial_client_balance_sat: Number().toString(),
              min_initial_lsp_balance_sat: args.min_capacity.toString(),
              min_onchain_payment_confirmations: null,
              min_onchain_payment_size_sat: null,
              supports_zero_channel_reserve: false,
            },
          },
        });
      }],

      // Send the terms response via p2p messaging
      sendInfoMessage: ['response', ({response}, cbk) => {
        return sendMessageToPeer({
          lnd: args.lnd,
          message: encodeMessage({
            error: response.error || undefined,
            id: response.id,
            jsonrpc: versionJsonRpc,
            result: response.result || undefined,
          }),
          public_key: args.to_peer,
          type: typeForMessaging,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
