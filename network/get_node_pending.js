const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getChannels} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {getPendingChannels} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const getPendingPaths = require('./get_pending_paths');
const pendingPayments = require('./pending_payments');
const {sortBy} = require('./../arrays');

const flatten = arr => [].concat(...arr);
const lookupTimeoutMs = 1000 * 10;
const uniq = arr => Array.from(new Set(arr));

/** Get pending channels and in-flight HTLCs for a node

  Items are sorted oldest first, by their creation time when it is known and
  otherwise by the blocks remaining until they resolve

  Debug details of pending channels, HTLCs and payments are logged in verbose

  {
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
  {
    closing: [{
      [blocks_until_recovery]: <Blocks Until Pending Balance Recovers Number>
      [close_transaction_id]: <Closing Transaction Id Hex String>
      [peer_alias]: <Peer Alias String>
      peer_public_key: <Peer Public Key Hex String>
      [pending_balance]: <Pending Recovery Tokens Number>
    }]
    forwarding: [{
      fee: <Routing Fee Tokens Number>
      [in_peer_alias]: <Inbound Peer Alias String>
      in_peer_public_key: <Inbound Peer Public Key Hex String>
      [out_peer_alias]: <Outbound Peer Alias String>
      out_peer_public_key: <Outbound Peer Public Key Hex String>
      tokens: <Forwarding Tokens Number>
    }]
    opening: [{
      capacity: <Channel Capacity Tokens Number>
      is_partner_initiated: <Peer Is Opening The Channel Bool>
      [peer_alias]: <Peer Alias String>
      peer_public_key: <Peer Public Key Hex String>
      transaction_id: <Funding Transaction Id Hex String>
    }]
    sending: [{
      [fee]: <Routing Fee Tokens Number>
      hops: [{
        [alias]: <Hop Node Alias String>
        public_key: <Hop Node Public Key Hex String>
      }]
      is_rebalance: <Payment Is Going Back To The Node Itself Bool>
      tokens: <Sending Tokens Number>
    }]
    [alias]: <Node Alias String>
    public_key: <Node Identity Public Key Hex String>
  }
*/
module.exports = ({lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetNodePendingItems']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToGetNodePendingItems']);
        }

        return cbk();
      },

      // Get channels to look for in-flight HTLCs
      getChannels: ['validate', ({}, cbk) => getChannels({lnd}, cbk)],

      // Get the node identity
      getInfo: ['validate', ({}, cbk) => getWalletInfo({lnd}, cbk)],

      // Get pending channels
      getPending: ['validate', ({}, cbk) => getPendingChannels({lnd}, cbk)],

      // Derive the HTLCs that are forwarding or sending
      htlcs: ['getChannels', ({getChannels}, cbk) => {
        return cbk(null, pendingPayments({channels: getChannels.channels}));
      }],

      // Look up the in-flight payments behind the outgoing HTLCs
      getPayments: ['htlcs', ({htlcs}, cbk) => {
        return asyncMap(uniq(htlcs.sending.map(n => n.id)), (id, cbk) => {
          return getPendingPaths({id, lnd, timeout_ms: lookupTimeoutMs}, cbk);
        },
        cbk);
      }],

      // Log the raw details behind the pending items for debugging
      debug: [
        'getPayments',
        'getPending',
        'htlcs',
        ({getPayments, getPending, htlcs}, cbk) =>
      {
        const hasHtlcs = !!htlcs.forwarding.length || !!htlcs.sending.length;

        // Exit early when there is nothing pending to debug
        if (!hasHtlcs && !getPending.pending_channels.length) {
          return cbk();
        }

        logger.debug({
          forwarding_htlcs: htlcs.forwarding,
          outgoing_htlcs: htlcs.sending,
          payments: getPayments.map(payment => ({
            id: payment.id,
            created_at: payment.created_at,
            paths: payment.paths.map(path => ({
              hops: path.hops.map(hop => `${hop.channel} ${hop.public_key}`),
              timeout: path.timeout,
              tokens: path.tokens,
            })),
          })),
          pending_channels: getPending.pending_channels.map(channel => ({
            blocks_until_expiry: channel.blocks_until_expiry,
            capacity: channel.capacity,
            close_transaction_id: channel.close_transaction_id,
            is_closing: channel.is_closing,
            is_opening: channel.is_opening,
            is_partner_initiated: channel.is_partner_initiated,
            is_timelocked: channel.is_timelocked,
            local_balance: channel.local_balance,
            partner_public_key: channel.partner_public_key,
            pending_balance: channel.pending_balance,
            pending_payments: channel.pending_payments,
            remote_balance: channel.remote_balance,
            timelock_blocks: channel.timelock_blocks,
            timelock_expiration: channel.timelock_expiration,
            transaction_id: channel.transaction_id,
            transaction_vout: channel.transaction_vout,
          })),
        });

        return cbk();
      }],

      // Outgoing HTLCs are matched to the paths of their in-flight payments
      routes: ['getPayments', 'htlcs', ({getPayments, htlcs}, cbk) => {
        const paths = flatten(getPayments.map(payment => {
          return payment.paths.map(path => ({
            path,
            created_at: payment.created_at,
            id: payment.id,
          }));
        }));

        // Every path can only be the route of a single outgoing HTLC
        const {routes} = htlcs.sending.reduce((sum, htlc) => {
          // An HTLC has the hash, first hop, amount and expiry of its route
          const match = sum.unmatched.find(({id, path}) => {
            const [firstHop] = path.hops;

            const isSameAmount = path.tokens === htlc.tokens;
            const isSameExpiry = path.timeout === htlc.timeout;
            const isSameHash = id === htlc.id;
            const isSameOutPeer = firstHop.public_key === htlc.out_peer;

            return isSameHash && isSameAmount && isSameExpiry && isSameOutPeer;
          });

          // Exit early when there are no payment details for the HTLC
          if (!match) {
            const hop = {forward: htlc.tokens, public_key: htlc.out_peer};

            return {
              routes: sum.routes.concat({hops: [hop]}),
              unmatched: sum.unmatched,
            };
          }

          const route = {
            created_at: match.created_at,
            fee: match.path.fee,
            hops: match.path.hops,
          };

          return {
            routes: sum.routes.concat(route),
            unmatched: sum.unmatched.filter(n => n !== match),
          };
        },
        {routes: [], unmatched: paths});

        return cbk(null, routes);
      }],

      // Get the aliases of the peers involved in pending items
      getAliases: [
        'getPending',
        'htlcs',
        'routes',
        ({getPending, htlcs, routes}, cbk) =>
      {
        const hops = flatten(routes.map(n => n.hops));

        const peers = []
          .concat(getPending.pending_channels.map(n => n.partner_public_key))
          .concat(htlcs.forwarding.map(n => n.in_peer))
          .concat(htlcs.forwarding.map(n => n.out_peer))
          .concat(hops.map(n => n.public_key));

        return asyncMap(uniq(peers), (id, cbk) => {
          return getNodeAlias({id, lnd}, cbk);
        },
        cbk);
      }],

      // Assemble the pending items
      pending: [
        'getAliases',
        'getInfo',
        'getPending',
        'htlcs',
        'routes',
        ({getAliases, getInfo, getPending, htlcs, routes}, cbk) =>
      {
        const alias = id => {
          return getAliases.find(n => n.id === id).alias || undefined;
        };

        const pending = getPending.pending_channels;

        // Closes waiting on a timelock are ordered by their remaining blocks
        const timelocked = sortBy({
          array: pending.filter(n => !!n.is_closing && !!n.is_timelocked),
          attribute: 'timelock_blocks',
        });

        // Closes that are not timelocked yet are the newest closes
        const waiting = pending.filter(n => n.is_closing && !n.is_timelocked);

        const closes = [].concat(timelocked.sorted).concat(waiting);

        // Channels that are closing, which may be waiting on funds recovery
        const closing = closes.map(channel => {
          // A timelock may hold the funds for some blocks before recovery
          const blocks = channel.timelock_blocks || Number();

          return {
            blocks_until_recovery: blocks > Number() ? blocks : undefined,
            close_transaction_id: channel.close_transaction_id,
            peer_alias: alias(channel.partner_public_key),
            peer_public_key: channel.partner_public_key,
            pending_balance: channel.pending_balance || undefined,
          };
        });

        // HTLCs that are being relayed from one peer to another
        const forwards = sortBy({
          array: htlcs.forwarding,
          attribute: 'timeout',
        });

        const forwarding = forwards.sorted.map(forward => ({
          fee: forward.fee,
          in_peer_alias: alias(forward.in_peer),
          in_peer_public_key: forward.in_peer,
          out_peer_alias: alias(forward.out_peer),
          out_peer_public_key: forward.out_peer,
          tokens: forward.tokens,
        }));

        // Channels that are waiting for funding confirmation
        const opens = sortBy({
          array: pending.filter(n => !!n.is_opening),
          attribute: 'blocks_until_expiry',
        });

        const opening = opens.sorted.map(channel => ({
          capacity: channel.capacity,
          is_partner_initiated: channel.is_partner_initiated,
          peer_alias: alias(channel.partner_public_key),
          peer_public_key: channel.partner_public_key,
          transaction_id: channel.transaction_id,
        }));

        // Payments with known creation dates are ordered by their dates
        const dated = sortBy({
          array: routes.filter(n => !!n.created_at),
          attribute: 'created_at',
        });

        // HTLCs that have no payment details are the newest payments
        const undated = routes.filter(n => !n.created_at);

        // Payments or probes that are going out through peers
        const sending = [].concat(dated.sorted).concat(undated).map(route => {
          const [finalHop] = route.hops.slice().reverse();

          return {
            fee: route.fee,
            hops: route.hops.map(hop => ({
              alias: alias(hop.public_key),
              public_key: hop.public_key,
            })),
            is_rebalance: finalHop.public_key === getInfo.public_key,
            tokens: finalHop.forward,
          };
        });

        return cbk(null, {
          closing,
          forwarding,
          opening,
          sending,
          alias: getInfo.alias || undefined,
          public_key: getInfo.public_key,
        });
      }],
    },
    returnResult({reject, resolve, of: 'pending'}, cbk));
  });
};
