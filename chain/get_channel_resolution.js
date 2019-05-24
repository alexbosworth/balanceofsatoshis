const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const request = require('request');
const {returnResult} = require('asyncjs-util');
const {Transaction} = require('bitcoinjs-lib');

const {resolutionType} = require('./../bolt03');

const closeSpendsDelayMs = 1000;
const getTxDelayMs = 2000;

/** Get channel resolution

  {
    close_transaction_id: <Close Transaction Id String>
    [is_cooperative_close]: <Channel Is Cooperatively Closed Bool>
  }

  @returns via cbk
  {
    [resolutions]: [{
      type: <Resolution Type String>
      value: <Value Number>
    }]
  }
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Check arguments
    validate: cbk => {
      if (!args.close_transaction_id) {
        return cbk([400, 'ExpectedCloseTransactionIdToGetChanResolution']);
      }

      return cbk();
    },

    // Get commitment transaction
    getCommitmentTransaction: ['validate', ({}, cbk) => {
      if (!!args.is_cooperative_close) {
        return cbk();
      }

      const id = args.close_transaction_id;

      return request({
        url: `https://blockstream.info/api/tx/${id}/hex`
      },
      (err, r, txHex) => {
        if (!!err) {
          return cbk([503, 'UnexpectedErrorGettingCommitTxInfo', err]);
        }

        if (!r || r.statusCode !== 200) {
          return cbk([503, 'UnexpectedResponseCodeWhenGettingCommitTx']);
        }

        if (!txHex) {
          return cbk([503, 'ExpectedTransactionForCommitTxId']);
        }

        return cbk(null, txHex);
      });
    }],

    // Get close tx output spends
    getCloseSpends: ['validate', ({}, cbk) => {
      if (!!args.is_cooperative_close) {
        return cbk(null, []);
      }

      const closeTxId = args.close_transaction_id;

      return request({
        json: true,
        url: `https://blockstream.info/api/tx/${closeTxId}/outspends`,
      },
      (err, r, outspends) => {
        if (!!err) {
          return cbk([503, 'UnexpectedErrorGettingOutspentsForTx', err]);
        }

        if (!r || r.statusCode !== 200) {
          return cbk([503, 'UnexpectedResponseCodeWhenGettingOutspends']);
        }

        if (!Array.isArray(outspends)) {
          return cbk([503, 'ExpectedJsonResultForTransactionOutspents']);
        }

        const unexpectedOutspend = outspends.find(n => {
          if (!n.spent) {
            return false;
          }

          return !n.txid || n.vin === undefined;
        });

        if (!!unexpectedOutspend) {
          return cbk([503, 'UnexpectedResultFromOutspendQuery', outspends]);
        }

        return setTimeout(() => {
          return cbk(null, outspends.map(outspend => ({
            txid: outspend.txid,
            vin: outspend.vin,
          })));
        },
        closeSpendsDelayMs);
      });
    }],

    // Get transactions
    getTransactions: ['getCloseSpends', ({getCloseSpends}, cbk) => {
      const txs = {};

      return asyncMapSeries(getCloseSpends, ({txid, vin}, cbk) => {
        if (!txid) {
          return cbk(null, {});
        }

        if (!!txs[txid]) {
          return cbk(null, {id: txid, transaction: txs[txid]});
        }

        return request({
          url: `https://blockstream.info/api/tx/${txid}/hex`
        },
        (err, r, txHex) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorGettingSpentTxInfo', err]);
          }

          if (!r || r.statusCode !== 200) {
            return cbk([503, 'UnexpectedResponseCodeWhenGettingTx']);
          }

          if (!txHex) {
            return cbk([503, 'ExpectedTransactionForSpendTxId']);
          }

          txs[txid] = txHex;

          return setTimeout(() => {
            return cbk(null, {id: txid, transaction: txHex});
          },
          getTxDelayMs);
        });
      },
      cbk);
    }],

    // Resolutions
    resolutions: [
      'getCloseSpends',
      'getCommitmentTransaction',
      'getTransactions',
      ({getCloseSpends, getCommitmentTransaction, getTransactions}, cbk) =>
    {
      if (!!args.is_cooperative_close) {
        return cbk(null, {});
      }

      const tx = Transaction.fromHex(getCommitmentTransaction);

      const resolutions = getCloseSpends.map(({txid, vin}, i) => {
        const {transaction} = getTransactions.find(n => txid === n.id) || {};

        const {value} = tx.outs[i];

        if (!transaction) {
          return {value, type: 'unspent'};
        }

        return {value, type: resolutionType({vin, transaction}).type};
      });

      if (!resolutions.length) {
        return cbk();
      }

      return cbk(null, {resolutions});
    }],
  },
  returnResult({of: 'resolutions'}, cbk));
};
