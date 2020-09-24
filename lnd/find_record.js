const asyncAuto = require('async/auto');
const {chanFormat} = require('bolt07');
const {getChannel} = require('ln-service');
const {getNetworkGraph} = require('ln-service');
const {getPayment} = require('ln-service');
const {getTransactionRecord} = require('ln-sync');
const moment = require('moment');
const {returnResult} = require('asyncjs-util');

const asBigUnit = tokens => (tokens / 1e8).toFixed(8);
const {isArray} = Array;
const isHash = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const notFound = 404;
const standardIdHexLength = Buffer.alloc(32).toString('hex').length;

/** Get record

  Try to find a record by id

  {
    lnd: <Authenticated LND gRPC API Object>
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

      // Get graph
      getGraph: ['validate', ({}, cbk) => getNetworkGraph({lnd}, cbk)],

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
        'getGraph',
        'getPayment',
        'getTx',
        ({getGraph, getPayment, getTx}, cbk) =>
      {
        const nodes = getGraph.nodes
          .filter(node => {
            if (node.alias.toLowerCase().includes(query.toLowerCase())) {
              return true;
            }

            return node.public_key === query;
          })
          .map(node => {
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
              public_key: node.public_key,
              updated: moment(node.updated_at).fromNow(),
              urls: node.sockets.map(socket => `${node.public_key}@${socket}`),
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
