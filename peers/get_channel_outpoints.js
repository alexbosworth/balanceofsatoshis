const asyncAuto = require('async/auto');
const {getChannels} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const chanAsOutpoint = n => `${n.transaction_id}:${n.transaction_vout}`;
const uniq = arr => Array.from(new Set(arr));

/** Get channel outpoints to check for open channel publish safety

  {
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    channels: [{
      transaction_id: <Transaction Id Hex String>
      transaction_vout: <Transaction Output Index Number>
    }]
  }
*/
module.exports = ({lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetChannelOutpoints']);
        }

        return cbk();
      },

      // Get regular channel outpoints
      getChannels: ['validate', ({}, cbk) => getChannels({lnd}, cbk)],

      // Get pending channel outpoints
      getPending: ['validate', ({}, cbk) => getPendingChannels({lnd}, cbk)],

      // Assemble channel outpoints
      outpoints: [
        'getChannels',
        'getPending',
        ({getChannels, getPending}, cbk) =>
      {
        const channelOutpoints = getChannels.channels.map(channel => ({
          transaction_id: channel.transaction_id,
          transaction_vout: channel.transaction_vout,
        }));

        const pendingOutpoints = getPending.pending_channels.map(channel => ({
          transaction_id: channel.transaction_id,
          transaction_vout: channel.transaction_vout,
        }));

        const channels = [].concat(channelOutpoints).concat(pendingOutpoints);

        if (uniq(channels.map(chanAsOutpoint)).length !== channels.length) {
          return cbk([503, 'UnexpectedDuplicateOutpointWithPendingChannels']);
        }

        return cbk(null, {channels});
      }],
    },
    returnResult({reject, resolve, of: 'outpoints'}, cbk));
  });
};
