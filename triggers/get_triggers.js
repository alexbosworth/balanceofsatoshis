const asyncAuto = require('async/auto');
const asyncUntil = require('async/until');
const {getInvoices} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const decodeTrigger = require('./decode_trigger');

const defaultInvoicesLimit = 100;

/** Get registered triggers

  {
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    triggers: [{
      [connectivity]: {
        id: <Node Identity Public Key Hex String>
      }
      [follow]: {
        id: <Node Identity Public Key Hex String>
      }
      id: <Trigger Id Hex String>
    }]
  }
*/
module.exports = ({lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetTriggers']);
        }

        return cbk();
      },

      // Get the past triggers
      getTriggers: ['validate', ({}, cbk) => {
        let token;
        const triggers = [];

        // Register past trigger invoices
        return asyncUntil(
          cbk => cbk(null, token === false),
          cbk => {
            return getInvoices({
              lnd,
              token,
              is_unconfirmed: true,
              limit: !token ? defaultInvoicesLimit : undefined,
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              token = res.next || false;

              res.invoices.forEach(({description, id}) => {
                try {
                  const trigger = decodeTrigger({encoded: description});

                  return triggers.push({
                    id,
                    connectivity: trigger.connectivity,
                    follow: trigger.follow,
                  });
                } catch (err) {
                  // Ignore invoices that are not triggers
                  return;
                }
              });

              return cbk();
            });
          },
          err => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, triggers);
          },
        );
      }],
    },
    returnResult({reject, resolve, of: 'getTriggers'}, cbk));
  });
};
