const asyncAuto = require('async/auto');
const asyncFilter = require('async/filter');
const {balancedOpenRequest} = require('paid-services');
const {getInvoices} = require('ln-service');
const {getPayment} = require('ln-service');
const {parsePaymentRequest} = require('invoices');
const {returnResult} = require('asyncjs-util');

const {balancedChannelKeyTypes} = require('./service_key_types');

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
        const nodes = [];

        const requests = getInvoices.invoices
          .filter(n => !!n.is_confirmed)
          .map(invoice => {
            const {proposal} = balancedOpenRequest({
              confirmed_at: invoice.confirmed_at,
              is_push: invoice.is_push,
              payments: invoice.payments,
              received_mtokens: invoice.received_mtokens,
            });

            // Exit early when there is no proposal
            if (!proposal) {
              return;
            }

            // Exit early when this peer already has a request
            if (nodes.includes(proposal.partner_public_key)) {
              return;
            }

            nodes.push(proposal.partner_public_key);

            return proposal;
          })
          .filter(n => !!n);

        return cbk(null, requests);
      }],

      // Filter out incoming opens that were already accepted
      unacceptedOpens: ['incomingOpens', ({incomingOpens}, cbk) => {
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
