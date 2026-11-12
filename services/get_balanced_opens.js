const asyncAuto = require('async/auto');
const asyncFilter = require('async/filter');
const asyncUntil = require('async/until');
const {balancedOpenRequest} = require('paid-services');
const {getInvoices} = require('ln-service');
const {getPayment} = require('ln-service');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {balancedChannelKeyTypes} = require('./service_key_types');

const lookbackMs = 1000 * 60 * 60 * 24;

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
        const after = new Date(Date.now() - lookbackMs).toISOString();
        const invoices = [];
        let token;

        // Page back through invoices created within the lookback
        return asyncUntil(
          cbk => cbk(null, token === false),
          cbk => {
            // No created_after, LND would walk all older invoices to apply it
            return getInvoices({lnd, token}, (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              token = res.next || false;

              // Stop paging once invoices were created before the lookback
              if (!!res.invoices.find(n => n.created_at < after)) {
                token = false;
              }

              const recent = res.invoices.filter(n => n.created_at >= after);

              invoices.push(...recent);

              return cbk();
            });
          },
          err => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {invoices});
          }
        );
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

      // Exclude requests with a pending or confirmed accept payment
      unacceptedOpens: ['incomingOpens', ({incomingOpens}, cbk) => {
        return asyncFilter(incomingOpens, (incoming, cbk) => {
          const {id} = parsePaymentRequest({request: incoming.accept_request});

          return getPayment({id, lnd}, (err, res) => {
            // Keep the proposal when there is no outgoing accept payment
            if (!!err && err.slice().shift() === 404) {
              return cbk(null, true);
            }

            if (!!err) {
              return cbk(err);
            }

            // Keep proposals whose accept payment failed
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
