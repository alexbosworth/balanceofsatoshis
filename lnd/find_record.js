const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const {chanFormat} = require('bolt07');
const {formatTokens} = require('ln-sync');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getHeight} = require('ln-service');
const {getNetworkGraph} = require('ln-service');
const {getNode} = require('ln-service');
const {getPayment} = require('ln-service');
const {getTransactionRecord} = require('ln-sync');
const {gray} = require('colorette');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const {findKey} = require('ln-sync');

const asBigUnit = tokens => (tokens / 1e8).toFixed(8);
const balance = ({display}) => display.trim() || gray('0.00000000');
const blocksTime = (n, p) => moment.duration(n * 10, 'minutes').humanize(p);
const {isArray} = Array;
const isHash = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const notFound = 404;
const standardIdHexLength = Buffer.alloc(32).toString('hex').length;

/** Get record

  Try to find a record by id

  {
    lnd: <Authenticated LND API Object>
    query: <Query String>
  }

  @returns via cbk or Promise
  {
    [chain_transaction]: {
      [chain_fee]: <Paid Transaction Fee Tokens Number>
      [received]: <Received Tokens Number>
      related_channels: [{
        action: <Channel Action String>
        [balance]: <Channel Balance Tokens Number>
        [capacity]: <Channel Capacity Value Number>
        [channel]: <Channel Standard Format Id String>
        [close_tx]: <Channel Closing Transaction Id Hex String>
        [open_tx]: <Channel Opening Transaction id Hex String>
        [timelock]: <Channel Funds Timelocked Until Height Number>
        with: <Channel Peer Public Key Hex String>
      }]
      [sent]: <Sent Tokens Number>
      [sent_to]: [<Sent to Address String>]
      [tx]: <Transaction Id Hex String>
    }
    [channels]: [<Channel Object>]
    [nodes]: [<Node Object>]
    [payment]: <Payment Object>
    [payment_failed]: <Payment Failed Object>
    [payment_pending]: <Payment Pending Bool>
  }
*/
module.exports = ({lnd, query}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndObjectToFindRecord']);
        }

        if (!query) {
          return cbk([400, 'QueryExpectedToFindRecord']);
        }

        return cbk();
      },

      // Get channels
      getChannels: ['validate', ({}, cbk) => getChannels({lnd}, cbk)],

      // Get closed
      getClosed: ['validate', ({}, cbk) => getClosedChannels({lnd}, cbk)],

      // Determine the public key to use
      getKey: ['validate', asyncReflect(({}, cbk) => {
        if (query.length === standardIdHexLength) {
          return cbk();
        }

        return findKey({lnd, query}, cbk);
      })],

      // Get graph
      getGraph: ['getKey', ({getKey}, cbk) => {
        if (query.length === standardIdHexLength) {
          return cbk(null, {channels: [], nodes: []});
        }

        if (!!getKey.value) {
          return getNode({
            lnd,
            public_key: getKey.value.public_key,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {
              channels: res.channels,
              nodes: [{
                alias: res.alias,
                color: res.color,
                features: res.features,
                public_key: getKey.value.public_key,
                sockets: res.sockets,
                updated_at: res.last_updated,
              }],
            });
          });
        }

        return getNetworkGraph({lnd}, cbk);
      }],

      // Get blockchain height
      getHeight: ['validate', ({}, cbk) => getHeight({lnd}, cbk)],

      // Payment
      getPayment: ['validate', ({}, cbk) => {
        if (query.length !== standardIdHexLength) {
          return cbk(null, {});
        }

        return getPayment({lnd, id: query}, (err, payment) => {
          if (!!isArray(err) && err.slice().shift() === notFound) {
            return cbk(null, {});
          }

          if (!!err) {
            return cbk(err);
          }

          return cbk(null, payment);
        });
      }],

      // Transaction
      getTx: ['validate', ({}, cbk) => {
        if (!isHash(query)) {
          return cbk();
        }

        return getTransactionRecord({lnd, id: query}, cbk);
      }],

      // Records
      records: [
        'getChannels',
        'getClosed',
        'getGraph',
        'getHeight',
        'getPayment',
        'getTx',
        ({
          getChannels,
          getClosed,
          getGraph,
          getHeight,
          getPayment,
          getTx,
        },
        cbk) =>
      {
        const nodes = getGraph.nodes
          .filter(node => {
            if (node.alias.toLowerCase().includes(query.toLowerCase())) {
              return true;
            }

            if (node.public_key.startsWith(query.toLowerCase())) {
              return true;
            }

            return node.public_key === query;
          })
          .map(node => {
            const hasLargeChannels = !!node.features
              .find(n => n.type === 'large_channels');

            return {
              alias: node.alias,
              capacity: asBigUnit(getGraph.channels.reduce(
                (sum, {capacity, policies}) => {
                  if (!policies.find(n => n.public_key === node.public_key)) {
                    return sum;
                  }

                  return sum + capacity;
                },
                Number()
              )),
              is_accepting_large_channels: hasLargeChannels || undefined,
              public_key: node.public_key,
              updated: moment(node.updated_at).fromNow(),
              urls: node.sockets.map(socket => `${node.public_key}@${socket}`),
              past_channels: getClosed.channels
                .filter(n => n.partner_public_key === node.public_key)
                .filter(n => !!n.id)
                .filter(n => !!n.close_confirm_height)
                .map(chan => {
                  const currentHeight = getHeight.current_block_height;
                  const [height] = chan.id.split('x');
                  const isCoopClose = chan.is_cooperative_close;
                  const removed = chan.close_confirm_height;

                  const coopClose = isCoopClose && !chan.is_partner_closed;
                  const peerCoopClose = isCoopClose && chan.is_partner_closed;

                  return {
                    age: blocksTime(removed - height),
                    closed: blocksTime(removed - currentHeight, true),
                    capacity: formatTokens({tokens: chan.capacity}).display,
                    breach_closed: chan.is_breach_close || undefined,
                    cooperative_closed: coopClose || undefined,
                    force_closed: chan.is_local_force_close || undefined,
                    peer_cooperatively_closed: peerCoopClose || undefined,
                    peer_force_closed: chan.is_remote_force_close || undefined,
                  };
                }),
              connected_channels: getChannels.channels
                .filter(n => n.partner_public_key === node.public_key)
                .filter(n => !!n.id)
                .map(chan => {
                  const [height] = chan.id.split('x');
                  const local = formatTokens({tokens: chan.local_balance});
                  const remote = formatTokens({tokens: chan.remote_balance});

                  const inbound = `in: ${balance(remote)}`;
                  const outbound = `out: ${balance(local)}`;

                  return {
                    age: blocksTime(getHeight.current_block_height - height),
                    liquidity: `${outbound} | ${inbound}`,
                    capacity: formatTokens({tokens: chan.capacity}).display,
                    funding: `${chan.transaction_id} ${chan.transaction_vout}`,
                    peer_created: chan.is_partner_initiated || undefined,
                  };
                }),
            }
          })
          .filter(node => node.capacity !== asBigUnit(0));

        const channels = getGraph.channels
          .filter(channel => {
            try {
              if (channel.id === chanFormat({number: query}).channel) {
                return true;
              }
            } catch (err) {}

            return channel.id === query;
          })
          .map(channel => {
            return {
              capacity: channel.capacity,
              id: channel.id,
              policies: channel.policies.map(policy => {
                const node = getGraph.nodes
                  .find(n => n.public_key === policy.public_key);

                return {
                  alias: !node ? undefined : node.alias,
                  base_fee_mtokens: policy.base_fee_mtokens,
                  cltv_delta: policy.cltv_delta,
                  fee_rate: policy.fee_rate,
                  is_disabled: policy.is_disabled,
                  max_htlc_mtokens: policy.max_htlc_mtokens,
                  min_htlc_mtokens: policy.min_htlc_mtokens,
                  public_key: policy.public_key,
                };
              }),
              transaction_id: channel.transaction_id,
              transaction_vout: channel.transaction_vout,
              updated_at: channel.updated_at,
            };
          });

        return cbk(null, {
          chain_transaction: !!getTx && !!getTx.tx ? getTx : undefined,
          channels: !!channels.length ? channels : undefined,
          nodes: !!nodes.length ? nodes : undefined,
          payment: getPayment.payment || undefined,
          payment_failed: getPayment.failed || undefined,
          payment_pending: getPayment.is_pending || undefined,
        });
      }],
    },
    returnResult({reject, resolve, of :'records'}, cbk));
  });
};
