const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const interaction = require('./interaction');

/** Check access to private commands

  {
    from: <Source User Id Number>
    id: <Connected User Id Number>
    reply: <Reply Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({from, id, reply}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!from) {
          return cbk([400, 'ExpectedFromUserIdToCheckAccess']);
        }

        if (!id) {
          return cbk([400, 'ExpectedConnectedUserIdToCheckAccess']);
        }

        if (!reply) {
          return cbk([400, 'ExpectedReplyFunctionToCheckAccess']);
        }

        return cbk();
      },

      // Check access
      checkAccess: ['validate', ({}, cbk) => {
        if (from !== id) {
          reply(interaction.ask_for_connect_code);

          return cbk([401, 'CommandRequiresConnectCode']);
        }

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
