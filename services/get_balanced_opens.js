const asyncAuto = require('async/auto');
const {getInvoices} = require('ln-service');
const {parsePaymentRequest} = require('invoices');
const {returnResult} = require('asyncjs-util');

const {balancedChannelKeyTypes} = require('./service_key_types');

const expectedRequestMtokens = '10000';
const expectedResponseMtokens = '1000';
const hexAsUtf8 = hex => Buffer.from(hex, 'hex').toString();
const isHexHashSized = hex => hex.length === 64;
const isHexNumberSized = hex => hex.length < 14;
const isOdd = n => n % 2;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const parseHexNumber = hex => parseInt(hex, 16);

/** Get balanced open requests received

  {
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    incoming: [{
      accept_request: <BOLT 11 Accept Open Request String>
      capacity: <Requested Channel Capacity Tokens Number>
      fee_rate: <Requested Channel Transit Tx Fee Tokens Per VByte Fee Number>
      partner_public_key: <Peer Public Key Hex String>
      proposed_at: <Request Received At ISO 8601 Date String>
      remote_multisig_key: <Peer Channel MultiSig Public Key Hex String>
      remote_tx_id: <Remote Transit Transaction Id Hex String>
      remote_tx_vout: <Remote Transit Transaction Output Index Number>
    }]
  }
*/
module.exports = ({lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetBalancedOpens']);
        }

        return cbk();
      },

      // Get invoices to see if there are any outstanding requests
      getInvoices: ['validate', ({}, cbk) => {
        return getInvoices({lnd}, cbk);
      }],

      // Filter out incoming opens that are still active
      incomingOpens: ['getInvoices', ({getInvoices}, cbk) => {
        const receivedRequests = getInvoices.invoices
          .filter(n => !!n.is_confirmed)
          .filter(n => !!n.is_push)
          .filter(n => n.received_mtokens === expectedRequestMtokens);

        const nodes = [];

        const balancedChannelRequests = receivedRequests.map(invoice => {
          const payment = invoice.payments.find(payment => {
            return !!payment.messages.find(({type}) => {
              return type === balancedChannelKeyTypes.accept_request;
            });
          });

          if (!payment) {
            return;
          }

          const acceptRequest = payment.messages.find(({type}) => {
            return type === balancedChannelKeyTypes.accept_request;
          });

          const request = hexAsUtf8(acceptRequest.value);

          try {
            parsePaymentRequest({request});
          } catch (err) {
            return;
          }

          const {destination, mtokens} = parsePaymentRequest({request});

          // Exit early when this peer already has a request
          if (nodes.includes(destination)) {
            return;
          }

          nodes.push(destination);

          if (mtokens !== expectedResponseMtokens) {
            return;
          }

          const channelCapacity = payment.messages.find(({type}) => {
            return type === balancedChannelKeyTypes.channel_capacity;
          });

          if (!channelCapacity || !isHexNumberSized(channelCapacity.value)) {
            return;
          }

          if (isOdd(parseHexNumber(channelCapacity.value))) {
            return;
          }

          const fundingFeeRate = payment.messages.find(({type}) => {
            return type === balancedChannelKeyTypes.funding_tx_fee_rate;
          });

          if (!fundingFeeRate || !isHexNumberSized(fundingFeeRate.value)) {
            return;
          }

          if (!parseHexNumber(fundingFeeRate.value)) {
            return;
          }

          const remoteMultiSigKey = payment.messages.find(({type}) => {
            return type === balancedChannelKeyTypes.multisig_public_key;
          });

          if (!remoteMultiSigKey) {
            return;
          }

          if (!isPublicKey(remoteMultiSigKey.value)) {
            return;
          }

          const remoteTxId = payment.messages.find(({type}) => {
            return type === balancedChannelKeyTypes.transit_tx_id;
          });

          if (!remoteTxId || !isHexHashSized(remoteTxId.value)) {
            return;
          }

          const remoteTxVout = payment.messages.find(({type}) => {
            return type === balancedChannelKeyTypes.transit_tx_vout;
          });

          if (!remoteTxVout || !isHexNumberSized(remoteTxVout.value)) {
            return;
          }

          return {
            accept_request: request,
            capacity: parseHexNumber(channelCapacity.value),
            fee_rate: parseHexNumber(fundingFeeRate.value),
            partner_public_key: destination,
            proposed_at: invoice.confirmed_at,
            remote_multisig_key: remoteMultiSigKey.value,
            remote_tx_id: remoteTxId.value,
            remote_tx_vout: parseHexNumber(remoteTxVout.value),
          };
        });

        return cbk(null, balancedChannelRequests.filter(n => !!n));
      }],

      // Filter out incoming opens that were already accepted
      unacceptedOpens: ['incomingOpens', ({incomingOpens}, cbk) => {
        const asyncFilter = require('async/filter');
        const {getPayment} = require('ln-service');
        return asyncFilter(incomingOpens, (incoming, cbk) => {
          const {id} = parsePaymentRequest({request: incoming.accept_request});

          return getPayment({id, lnd}, (err, res) => {
            // An unknown payment means the open was not ack'ed
            if (!!err && err.slice().shift() === 404) {
              return cbk(null, true);
            }

            if (!!err) {
              return cbk(err);
            }

            // If an accept request was not paid nothing happened yet
            return cbk(null, !!res.is_failed);
          });
        },
        cbk);
      }],

      // Final set of active balanced open requests
      opens: ['unacceptedOpens', ({unacceptedOpens}, cbk) => {
        return cbk(null, {incoming: unacceptedOpens});
      }],
    },
    returnResult({reject, resolve, of: 'opens'}, cbk));
  });
};
