const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncMapLimit = require('async/mapLimit');
const {getPayment} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const getAllInvoices = require('./../wallets/get_all_invoices');

const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const maxGetPayments = 100;
const notFound = 404;

/** Get payments that were rebalances

  {
    after: <Rebalance Payments After ISO 8601 Date String>
    lnds: [<Authenticated LND API Object>]
  }

  @returns via cbk or Promise
  {
    payments: [{
      attempts: [{
        [failure]: {
          code: <Error Type Code Number>
          [details]: {
            [channel]: <Standard Format Channel Id String>
            [height]: <Error Associated Block Height Number>
            [index]: <Failed Hop Index Number>
            [mtokens]: <Error Millitokens String>
            [policy]: {
              base_fee_mtokens: <Base Fee Millitokens String>
              cltv_delta: <Locktime Delta Number>
              fee_rate: <Fees Charged in Millitokens Per Million Number>
              [is_disabled]: <Channel is Disabled Bool>
              max_htlc_mtokens: <Maximum HLTC Millitokens Value String>
              min_htlc_mtokens: <Minimum HTLC Millitokens Value String>
              updated_at: <Updated At ISO 8601 Date String>
            }
            [timeout_height]: <Error CLTV Timeout Height Number>
            [update]: {
              chain: <Chain Id Hex String>
              channel_flags: <Channel Flags Number>
              extra_opaque_data: <Extra Opaque Data Hex String>
              message_flags: <Message Flags Number>
              signature: <Channel Update Signature Hex String>
            }
          }
          message: <Error Message String>
        }
        [index]: <Payment Add Index Number>
        [confirmed_at]: <Payment Confirmed At ISO 8601 Date String>
        is_confirmed: <Payment Attempt Succeeded Bool>
        is_failed: <Payment Attempt Failed Bool>
        is_pending: <Payment Attempt is Waiting For Resolution Bool>
        route: {
          fee: <Route Fee Tokens Number>
          fee_mtokens: <Route Fee Millitokens String>
          hops: [{
            channel: <Standard Format Channel Id String>
            channel_capacity: <Channel Capacity Tokens Number>
            fee: <Fee Number>
            fee_mtokens: <Fee Millitokens String>
            forward: <Forward Tokens Number>
            forward_mtokens: <Forward Millitokens String>
            [public_key]: <Forward Edge Public Key Hex String>
            [timeout]: <Timeout Block Height Number>
          }]
          mtokens: <Total Fee-Inclusive Millitokens String>
          [payment]: <Payment Identifier Hex String>
          timeout: <Timeout Block Height Number>
          tokens: <Total Fee-Inclusive Tokens Number>
          [total_mtokens]: <Total Millitokens String>
        }
      }]
      confirmed_at: <Payment Confirmed At ISO 8601 Date String>
      created_at: <Payment at ISO-8601 Date String>
      destination: <Destination Node Public Key Hex String>
      fee: <Paid Routing Fee Rounded Down Tokens Number>
      fee_mtokens: <Paid Routing Fee in Millitokens String>
      hops: [<First Route Hop Public Key Hex String>]
      id: <Payment Preimage Hash String>
      [index]: <Payment Add Index Number>
      is_confirmed: <Payment is Confirmed Bool>
      is_outgoing: <Transaction Is Outgoing Bool>
      mtokens: <Millitokens Sent to Destination String>
      [request]: <BOLT 11 Payment Request String>
      safe_fee: <Payment Forwarding Fee Rounded Up Tokens Number>
      safe_tokens: <Payment Tokens Rounded Up Number>
      secret: <Payment Preimage Hex String>
      tokens: <Rounded Down Tokens Sent to Destination Number>
    }]
  }
*/
module.exports = ({after, lnds}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!after) {
          return cbk([400, 'ExpectedAfterDateToGetRebalancePayments']);
        }

        if (!isArray(lnds)) {
          return cbk([400, 'ExpectedArrayOfLndsToGetRebalancePayments']);
        }

        return cbk();
      },

      // Get all the settled invoices
      getSettled: ['validate', ({}, cbk) => {
        return asyncMap(lnds, (lnd, cbk) => {
          return getAllInvoices({lnd, created_after: after}, cbk);
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, flatten(res.map(({invoices}) => invoices)));
        });
      }],

      // Find self-payments by looking for payments with invoice ids
      getRebalances: ['getSettled', ({getSettled}, cbk) => {
        return asyncMap(lnds, (lnd, cbk) => {
          return asyncMapLimit(getSettled, maxGetPayments, ({id}, cbk) => {
            return getPayment({id, lnd}, (err, res) => {
              // Exit early when there is no matching payment
              if (isArray(err) && err.shift() === notFound) {
                return cbk();
              }

              if (!!err) {
                return cbk(err);
              }

              return cbk(null, res.payment);
            });
          },
          (err, payments) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, payments.filter(n => !!n));
          });
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          return cbk(null, {payments: flatten(res)});
        });
      }],
    },
    returnResult({reject, resolve, of: 'getRebalances'}, cbk));
  });
};
