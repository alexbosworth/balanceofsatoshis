const asyncAuto = require('async/auto');
const asyncUntil = require('async/until');
const {returnResult} = require('asyncjs-util');

const {getInvoices} = require('ln-service');

const defaultInvoicesLimit = 100;

/** Get all invoices

  {
    [confirmed_after]: <Confirmed At or After ISO 8601 Date String>
    [created_after]: <Confirmed At or After ISO 8601 Date String>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    invoices: [{
      [chain_address]: <Fallback Chain Address String>
      cltv_delta: <Final CLTV Delta Number>
      [confirmed_at]: <Settled at ISO 8601 Date String>
      created_at: <ISO 8601 Date String>
      description: <Description String>
      [description_hash]: <Description Hash Hex String>
      expires_at: <ISO 8601 Date String>
      features: [{
        bit: <BOLT 09 Feature Bit Number>
        is_known: <Feature is Known Bool>
        is_required: <Feature Support is Required To Pay Bool>
        type: <Feature Type String>
      }]
      id: <Payment Hash String>
      [is_canceled]: <Invoice is Canceled Bool>
      is_confirmed: <Invoice is Confirmed Bool>
      [is_held]: <HTLC is Held Bool>
      is_private: <Invoice is Private Bool>
      [is_push]: <Invoice is Push Payment Bool>
      payments: [{
        [confirmed_at]: <Payment Settled At ISO 8601 Date String>
        created_at: <Payment Held Since ISO 860 Date String>
        created_height: <Payment Held Since Block Height Number>
        in_channel: <Incoming Payment Through Channel Id String>
        is_canceled: <Payment is Canceled Bool>
        is_confirmed: <Payment is Confirmed Bool>
        is_held: <Payment is Held Bool>
        messages: [{
          type: <Message Type Number String>
          value: <Raw Value Hex String>
        }]
        mtokens: <Incoming Payment Millitokens String>
        [pending_index]: <Pending Payment Channel HTLC Index Number>
        tokens: <Payment Tokens Number>
        [total_mtokens]: <Total Millitokens String>
      }]
      received: <Received Tokens Number>
      received_mtokens: <Received Millitokens String>
      [request]: <Bolt 11 Invoice String>
      secret: <Secret Preimage Hex String>
      tokens: <Tokens Number>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetAllInvoices']);
        }

        return cbk();
      },

      // Get all the invoices
      getInvoices: ['validate', ({}, cbk) => {
        const confAfter = args.confirmed_after;
        const createdAfter = args.created_after;
        const invoices = [];
        let token;

        return asyncUntil(
          cbk => cbk(null, token === false),
          cbk => {
            return getInvoices({
              token,
              limit: !token ? defaultInvoicesLimit : undefined,
              lnd: args.lnd,
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              token = res.next || false;

              res.invoices
                .filter(n => !confAfter || n.confirmed_at >= confAfter)
                .filter(n => !createdAfter || n.created_at >= createdAfter)
                .forEach(n => invoices.push(n));

              const createdAt = res.invoices.map(n => n.created_at);

              // Stop paging when created after is set
              if (!!createdAfter && createdAt.find(n => n < createdAfter)) {
                token = false;
              }

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
    },
    returnResult({reject, resolve, of: 'getInvoices'}, cbk));
  });
};
