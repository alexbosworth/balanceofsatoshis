const asyncAuto = require('async/auto');
const asyncUntil = require('async/until');
const {getChannels} = require('ln-service');
const {getForwards} = require('ln-service');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const forwardsViaPeer = require('./forwards_via_peer');

const isPublicKey = n => /^[0-9A-F]{66}$/i.test(n);
const pageLimit = 1e3;

/** Get forwards

  {
    after: <After Date ISO 8601 String>
    lnd: <Authenticated LND API Object>
    [via]: <Via Public Key Hex String>
  }

  @returns via cbk or Promise
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
module.exports = ({after, lnd, via}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!after) {
          return cbk([400, 'ExpectedAfterDateToGetForwardsForNode']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetForwardsForNode']);
        }

        if (!!via && !isPublicKey(via)) {
          return cbk([400, 'ExpectedPublicKeyForViaFilterOfForwardsForNode']);
        }

        return cbk();
      },

      // Get forwards
      getForwards: ['validate', ({}, cbk) => {
        const forwards = [];
        const start = new Date().toISOString();
        let token;

        return asyncUntil(
          cbk => cbk(null, token === false),
          cbk => {
            return getForwards({
              after,
              lnd,
              token,
              before: start,
              limit: !token ? pageLimit : undefined,
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              limit = null;
              token = res.next || false;

              res.forwards.forEach(n => forwards.push(n));

              return cbk();
            });
          },
          err => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, forwards);
          }
        );
      }],

      // Get private channels
      getPrivateChannels: ['validate', ({}, cbk) => {
        // Exit early when there is no via node specified
        if (!via) {
          return cbk();
        }

        return getChannels({
          lnd,
          is_private: true,
          partner_public_key: via,
        },
        cbk);
      }],

      // Get node details
      getNode: ['validate', ({}, cbk) => {
        // Exit early when there is no via node specified
        if (!via) {
          return cbk();
        }

        return getNode({lnd, public_key: via}, cbk);
      }],

      // Full set of forwards
      forwards: [
        'getForwards',
        'getNode',
        'getPrivateChannels',
        ({getForwards, getNode, getPrivateChannels}, cbk) =>
      {
        const {forwards} = forwardsViaPeer({
          via,
          forwards: getForwards,
          private_channels: !!via ? getPrivateChannels.channels : [],
          public_channels: !!via ? getNode.channels : [],
        });

        return cbk(null, {forwards});
      }],
    },
    returnResult({reject, resolve, of: 'forwards'}, cbk));
  });
};
