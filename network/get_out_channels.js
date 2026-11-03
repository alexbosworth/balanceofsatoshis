const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const asyncReflect = require('async/reflect');
const {getChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const getOutPeers = require('./get_out_peers');

const flatten = arr => [].concat(...arr);
const inactiveTagError = 'NoActivePeersFoundForOutTag';
const {isArray} = Array;
const noMatchError = 'NoPeerMatchesFoundToSatisfyOutboundFilter';
const uniq = arr => Array.from(new Set(arr));

/** Get the channels to route out through, applying out filters

  Out peers that fail the filters or have no active channel are left out

  {
    [filters]: [<Outbound Peer Filter Formula String>]
    [fs]: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    lnd: <Authenticated LND API Object>
    out: [<Out Through Peer With Public Key, Alias, or Tag String>]
  }

  @returns via cbk or Promise
  {
    [channels]: [<Out Through Standard Format Channel Id String>]
    public_keys: [<Out Through Peer Public Key Hex String>]
  }
*/
module.exports = ({filters, fs, lnd, out}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetOutChannels']);
        }

        if (!isArray(out)) {
          return cbk([400, 'ExpectedArrayOfOutPeersToGetOutChannels']);
        }

        // Filters narrow down out peers so there must be out peers to filter
        if (!out.length && !!filters && !!filters.length) {
          return cbk([400, noMatchError]);
        }

        return cbk();
      },

      // Find public keys to pay out through for each out peer or tag
      getOuts: ['validate', ({}, cbk) => {
        return asyncMapSeries(out, (query, cbk) => {
          return asyncReflect(getOutPeers)({
            filters,
            fs,
            lnd,
            out: [query],
          },
          cbk);
        },
        cbk);
      }],

      // Out peers that pass the filters, leaving out the ones that do not and
      // tags with no active peers
      peers: ['getOuts', ({getOuts}, cbk) => {
        const errors = getOuts.filter(n => !!n.error).map(n => n.error);
        const leftOut = [inactiveTagError, noMatchError];

        // An error other than an out peer being left out is passed back
        const [err] = errors.filter(([, msg]) => !leftOut.includes(msg));

        if (!!err) {
          return cbk(err);
        }

        const found = getOuts.filter(n => !n.error).map(n => n.value);

        return cbk(null, uniq(flatten(found.map(n => n.public_keys))));
      }],

      // Get channels with the out peers
      getChannels: ['peers', ({}, cbk) => {
        // Exit early when there is no outbound restriction
        if (!out.length) {
          return cbk();
        }

        return getChannels({lnd}, cbk);
      }],

      // Channels to go out through, with the out peers that have them
      channels: ['getChannels', 'peers', ({getChannels, peers}, cbk) => {
        // Exit early when there is no outbound restriction
        if (!out.length) {
          return cbk(null, {public_keys: []});
        }

        const withPeer = getChannels.channels
          .filter(n => !!n.is_active)
          .filter(n => peers.includes(n.partner_public_key));

        // Exit with error when the filters left no out peer to go through
        if (!withPeer.length && !!filters && !!filters.length) {
          return cbk([400, noMatchError]);
        }

        // Exit with error when no out peer has an active channel
        if (!withPeer.length) {
          return cbk([404, 'NoActiveChannelWithOutgoingPeer']);
        }

        const keys = withPeer.map(n => n.partner_public_key);

        return cbk(null, {
          channels: withPeer.map(n => n.id),
          public_keys: peers.filter(key => keys.includes(key)),
        });
      }],
    },
    returnResult({reject, resolve, of: 'channels'}, cbk));
  });
};
