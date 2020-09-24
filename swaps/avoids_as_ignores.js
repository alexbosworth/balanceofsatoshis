const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {findKey} = require('ln-sync');
const {getChannel} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const channelMatch = /^\d*x\d*x\d*$/;
const flatten = arr => [].concat(...arr);
const isPublicKey = n => /^[0-9A-F]{66}$/i.test(n);

/** Convert avoid directives to a list of ignore directives

  {
    [avoid]: [<Avoid Public Key or Channel Id Or Peer Alias String>]
    [channels]: [{
      partner_public_key: <Partner Public Key Hex String>
    }]
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    ignore: [{
      from_public_key: <From Public Key Hex String>
      [to_public_key]: <To Public Key Hex String>
    }]
  }
*/
module.exports = ({avoid, channels, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetIgnoresList']);
        }

        return cbk();
      },

      // Get ignores
      getIgnores: ['validate', ({}, cbk) => {
        return asyncMap(avoid || [], (id, cbk) => {
          // Exit early when the id is a public key
          if (isPublicKey(id)) {
            return cbk(null, {from_public_key: id});
          }

          // Exit early when the id is a peer query
          if (!channelMatch.test(id)) {
            return findKey({channels, lnd, query: id}, (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              return cbk(null, {from_public_key: res.public_key});
            });
          }

          return getChannel({id, lnd}, (err, res) => {
            if (!!err) {
              return cbk([404, 'FailedToFindChannelToAvoid', {err, id}]);
            }

            const [node1, node2] = res.policies.map(n => n.public_key);

            const ignore = [
              {channel: id, from_public_key: node1, to_public_key: node2},
              {channel: id, from_public_key: node2, to_public_key: node1},
            ];

            return cbk(null, ignore);
          });
        },
        cbk);
      }],

      // Final list of ignores
      ignoreList: ['getIgnores', ({getIgnores}, cbk) => {
        return cbk(null, {ignore: flatten(getIgnores)});
      }],
    },
    returnResult({reject, resolve, of: 'ignoreList'}, cbk));
  });
};
