const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {formatTokens} = require('ln-sync');
const {getNodeFunds} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const format = tokens => formatTokens({tokens}).display.trim();
const {isArray} = Array;

/** Get a detailed balance that categorizes balance of tokens on the node

  {
    [is_confirmed]: <Only Consider Confirmed Transactions Bool>
    lnds: [<Authenticated LND API Object>]
  }

  @returns via cbk or Promise
  {
    [closing_balance]: <Total Coins Closing Big Unit Tokens String>
    [conflicted_pending]: <Conflicted Transaction Big Unit Tokens String>
    [invalid_pending]: <Invalid Pending Tokens Big Unit Tokens String>
    [offchain_balance]: <Channel Tokens Balance Big Unit Tokens String>
    [offchain_pending]: <Pending Channel Tokens Balance Big Unit Tokens String>
    [onchain_confirmed]: <Confirmed On Chain Balance Big Unit Tokens String>
    [onchain_pending]: <Pending Chain Tokens Balance Big Unit Tokens String>
    [onchain_vbytes]: <UTXO Footprint Virtual Bytes Number>
    [utxos_count]: <Total UTXOs Count Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.lnds)) {
          return cbk([400, 'ExpectedAuthenticatedLndsToGetDetailedBalance']);
        }

        return cbk();
      },

      // Get info about the funds on the node
      getFunds: ['validate', ({}, cbk) => {
        return asyncMap(args.lnds, (lnd, cbk) => {
          return getNodeFunds({lnd, is_confirmed: args.is_confirmed}, cbk);
        },
        cbk);
      }],

      // Return a formatted balance summary
      balance: ['getFunds', ({getFunds}, cbk) => {
        // Sum balances from all nodes
        const balances = getFunds.reduce((sum, n) => {
          return {
            closing_balance: sum.closing_balance + n.closing_balance,
            conflicted_pending: sum.conflicted_pending + n.conflicted_pending,
            invalid_pending: sum.invalid_pending + n.invalid_pending,
            offchain_balance: sum.offchain_balance + n.offchain_balance,
            offchain_pending: sum.offchain_pending + n.offchain_pending,
            onchain_confirmed: sum.onchain_confirmed + n.onchain_confirmed,
            onchain_pending: sum.onchain_pending + n.onchain_pending,
            onchain_vbytes: sum.onchain_vbytes + n.onchain_vbytes,
            utxos_count: sum.utxos_count + n.utxos_count,
          };
        },
        {
          closing_balance: Number(),
          conflicted_pending: Number(),
          invalid_pending: Number(),
          offchain_balance: Number(),
          offchain_pending: Number(),
          onchain_confirmed: Number(),
          onchain_pending: Number(),
          onchain_vbytes: Number(),
          utxos_count: Number(),
        });

        return cbk(null, {
          closing_balance: format(balances.closing_balance) || undefined,
          conflicted_pending: format(balances.conflicted_pending) || undefined,
          invalid_pending: format(balances.invalid_pending) || undefined,
          offchain_balance: format(balances.offchain_balance) || undefined,
          offchain_pending: format(balances.offchain_pending) || undefined,
          onchain_confirmed: format(balances.onchain_confirmed) || undefined,
          onchain_pending: format(balances.onchain_pending) || undefined,
          onchain_vbytes: balances.onchain_vbytes || undefined,
          utxos_count: balances.utxos_count || undefined,
        });
      }],
    },
    returnResult({reject, resolve, of: 'balance'}, cbk));
  });
};
