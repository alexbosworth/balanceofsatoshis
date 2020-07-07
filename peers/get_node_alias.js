const asyncAuto = require('async/auto');
const {getNode} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const isPublicKey = n => !!n && /^[0-9A-F]{66}$/i.test(n);

/** Get the alias of a node, ignoring errors

  {
    id: <Node Identity Public Key Hex String>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    alias: <Node Alias String>
    id: <Node Identity Public Key Hex String>
  }
*/
module.exports = ({id, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isPublicKey(id)) {
          return cbk([400, 'ExpectedPublicKeyToGetNodeAliasFor']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetNodeAlias']);
        }

        return cbk();
      },

      // Lookup the node
      getAlias: ['validate', ({}, cbk) => {
        return getNode({
          lnd,
          is_omitting_channels: true,
          public_key: id,
        },
        (err, res) => {
          if (!!err || !res || !res.alias) {
            return cbk(null, {id, alias: String()});
          }

          return cbk(null, {id, alias: res.alias});
        });
      }],
    },
    returnResult({reject, resolve, of: 'getAlias'}, cbk));
  });
};
