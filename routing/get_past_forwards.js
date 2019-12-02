const asyncAuto = require('async/auto');
const asyncDoUntil = require('async/doUntil');
const {getForwards} = require('ln-service');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const flatten = arr => [].concat(...arr);

/** Get forwards from the past N days

  {
    [days]: <Past Days To Get Forwards Over Number>
    lnd: <Authenticated LND gRPC API Object>
  }

  @returns via cbk
  {
    forwards: [{
      created_at: <Forward Record Created At ISO 8601 Date String>
      fee: <Fee Tokens Charged Number>
      fee_mtokens: <Approximated Fee Millitokens Charged String>
      incoming_channel: <Incoming Standard Format Channel Id String>
      [mtokens]: <Forwarded Millitokens String>
      outgoing_channel: <Outgoing Standard Format Channel Id String>
      tokens: <Forwarded Tokens Number>
    }]
  }
*/
module.exports = ({days, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndObjectToGetPastForwards']);
        }

        return cbk();
      },

      // Get past forwards
      getForwards: ['validate', ({}, cbk) => {
        // Exit early when there are no days to get forwards over
        if (!days) {
          return cbk(null, []);
        }

        const after = moment().subtract(days, 'days').toISOString();
        const before = new Date().toISOString();
        let token;
        const forwards = [];

        return asyncDoUntil(
          cbk => {
            return getForwards({after, before, lnd, token}, (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              forwards.push(res.forwards);

              token = res.next;

              return cbk();
            });
          },
          cbk => cbk(null, !token),
          err => !!err ? cbk(err) : cbk(null, forwards)
        );
      }],

      // Final set of forwards
      forwards: ['getForwards', ({getForwards}, cbk) => {
        return cbk(null, {forwards: flatten(getForwards)});
      }],
    },
    returnResult({reject, resolve, of: 'forwards'}, cbk));
  });
};
