const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getChainTransactions} = require('ln-service');
const {getChannels} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {Transaction} = require('bitcoinjs-lib');

const transactionRecords = require('./transaction_records');

const {fromHex} = Transaction;
const uniq = arr => Array.from(new Set(arr));

/** Get LND internal record associated with a transaction id

  {
    id: <Transaction Id Hex String>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
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
*/
module.exports = ({id, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: async () => {
        if (!id) {
          throw [400, 'ExpectedTransactionIdToFindRecordData'];
        }

        if (!lnd) {
          throw [400, 'ExpectedLndToFindChainTransactionRecordData'];
        }

        return;
      },

      // Get channels
      getChannels: ['validate', ({}, cbk) => getChannels({lnd}, cbk)],

      // Get closed channels
      getClosed: ['validate', ({}, cbk) => getClosedChannels({lnd}, cbk)],

      // Get pending transactions
      getPending: ['validate', ({}, cbk) => getPendingChannels({lnd}, cbk)],

      // Get transactions
      getTx: ['validate', ({}, cbk) => getChainTransactions({lnd}, cbk)],

      // Determine relationship of transaction id to records
      record: [
        'getChannels',
        'getClosed',
        'getPending',
        'getTx',
        async ({getChannels, getClosed, getPending, getTx}, cbk) =>
      {
        const records = [];
        const relatedChannels = [];

        const chans = getChannels.channels.filter(channel => {
          return channel.transaction_id === id;
        });

        const chanClosing = getClosed.channels.find(channel => {
          return channel.close_transaction_id === id;
        });

        const closingChans = getClosed.channels.filter(channel => {
          return channel.transaction_id === id;
        });

        const tx = getTx.transactions.find(transaction => {
          return transaction.id === id;
        });

        if (!!closingChans.length) {
          closingChans.forEach(channel => {
            return records.push({
              action: 'opened_channel',
              capacity: channel.capacity,
              channel: channel.id,
              close_tx: channel.close_transaction_id,
              open_tx: channel.transaction_id,
              with: channel.partner_public_key,
            });
          });
        }

        if (!!chans.length) {
          chans.forEach(channel => {
            return records.push({
              action: 'opened_channel',
              capacity: channel.capacity,
              channel: channel.id,
              open_tx: channel.transaction_id,
              with: channel.partner_public_key,
            });
          });
        }

        if (!!chanClosing) {
          if (chanClosing.is_cooperative_close) {
            records.push({
              action: 'cooperatively_closed_channel',
              balance: chanClosing.final_local_balance,
              capacity: chanClosing.capacity || undefined,
              channel: chanClosing.id,
              close_tx: chanClosing.close_transaction_id,
              open_tx: chanClosing.transaction_id,
              with: chanClosing.partner_public_key,
            });
          }

          if (!!chanClosing.is_local_force_close) {
            records.push({
              action: 'force_closed_channel',
              balance: chanClosing.final_local_balance,
              capacity: chanClosing.capacity || undefined,
              channel: chanClosing.id,
              close_tx: chanClosing.close_transaction_id,
              open_tx: chanClosing.transaction_id,
              with: chanClosing.partner_public_key,
            });
          }

          if (!!chanClosing.is_remote_force_close) {
            records.push({
              action: 'peer_force_closed_channel',
              balance: chanClosing.final_local_balance,
              capacity: chanClosing.capacity || undefined,
              channel: chanClosing.id,
              close_tx: chanClosing.close_transaction_id,
              open_tx: chanClosing.transaction_id,
              with: chanClosing.partner_public_key,
            });
          }
        }

        if (!!closingChans.length) {
          closingChans.forEach(closing => {
            if (!!closing.is_remote_force_close) {
              records.push({
                action: 'peer_force_closed_channel',
                balance: closing.final_local_balance,
                capacity: closing.capacity,
                channel: closing.id,
                close_tx: closing.close_transaction_id,
                open_tx: closing.transaction_id,
                with: closing.partner_public_key,
              });
            }
          });
        }

        if (!!tx && !!tx.transaction) {
          fromHex(tx.transaction).ins.forEach(({hash, index}) => {
            const txRecords = transactionRecords({
              ended: getClosed.channels,
              id: hash.reverse().toString('hex'),
              original: id,
              pending: getPending.pending_channels,
              txs: getTx.transactions,
            });

            txRecords.records.forEach(record => records.push(record));
          });
        }

        records.forEach(record => {
          const {action} = record;
          const {channel} = record;

          const existing = relatedChannels
            .filter(() => !!channel)
            .find(n => n.action === action && n.channel === channel);

          // Exit early when this related channel action already exists
          if (!!existing) {
            return;
          }

          return relatedChannels.push({
            action,
            balance: record.balance || undefined,
            capacity: record.capacity || undefined,
            channel: record.channel || undefined,
            close_tx: record.close_tx || undefined,
            open_tx: record.open_tx || undefined,
            timelock: record.timelock || undefined,
            with: record.with,
          });
        });

        const hasFee = !!tx && !!tx.fee;
        const isIncoming = !!tx && !tx.is_outgoing && !!tx.tokens;

        return {
          chain_fee: hasFee ? tx.fee : undefined,
          received: isIncoming ? tx.tokens : undefined,
          related_channels: relatedChannels,
          sent: !records.length ? tx.tokens : undefined,
          sent_to: !records.length ? tx.output_addresses : undefined,
          tx: !!tx ? tx.id : undefined,
        };
      }],

      // Record details
      details: ['record', ({record}, cbk) => {
        const keys = uniq(record.related_channels.map(n => n.with));

        return asyncMap(keys, (key, cbk) => {
          return getNode({
            lnd,
            is_omitting_channels: true,
            public_key: key,
          },
          (err, res) => {
            // Ignore errors
            if (!!err || !res.alias) {
              return cbk();
            }

            return cbk(null, {alias: res.alias, public_key: key});
          });
        },
        (err, nodes) => {
          if (!!err) {
            return cbk(err);
          }

          const relatedWithAlias = record.related_channels.map(related => {
            const node = nodes.find(n => !!n && n.public_key === related.with);

            related.node = !!node && !!node.alias ? node.alias : undefined;

            return related;
          });

          return cbk(null, {
            chain_fee: record.chain_fee,
            received: record.received,
            related_channels: relatedWithAlias,
            sent: record.sent,
            sent_to: record.sent_to,
            tx: record.tx,
          });
        });
      }],
    },
    returnResult({reject, resolve, of: 'details'}, cbk));
  });
};
