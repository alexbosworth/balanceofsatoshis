const {Transaction} = require('bitcoinjs-lib');

const inputAsOutpoint = (txId, outputIndex) => `${txId}:${outputIndex}`;
const {fromHex} = Transaction;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const txIdFromHash = hash => hash.slice().reverse().toString('hex');
const uniq = arr => Array.from(new Set(arr));

/** Derive conflicted on-chain pending balances where funds are double spent or
  multiple versions of the spend exist

  {
    transactions: [{
      is_confirmed: <Transaction is Confirmed Bool>
      transaction: <Raw Transaction Hex String>
    }]
    utxos: [{
      confirmation_count: <UTXO Confirmation Count Number>
      tokens: <UTXO Tokens Number>
      transaction_id: <Outpoint Transaction Id Hex String>
    }]
  }

  @returns
  {
    conflicting_pending_balance: <Conflicting Pending Balance Tokens Number>
    invalid_pending_balance: <Invalid Pending Balance Tokens Number>
  }
*/
module.exports = ({transactions, utxos}) => {
  const conflictingUtxos = [];
  const invalidUtxos = [];
  const spends = {}

  // Look at unconfirmed UTXOs and collect spends of outpoints
  utxos.filter(n => !n.confirmation_count).forEach((utxo, i) => {
    const tx = transactions.find(n => n.id === utxo.transaction_id);

    // Exit early when the raw transaction is not known
    if (!tx || !tx.transaction) {
      return;
    }

    // Register all the inputs into the spends map
    return fromHex(tx.transaction).ins.forEach(input => {
      const outpoint = inputAsOutpoint(txIdFromHash(input.hash), input.index);

      const existing = spends[outpoint];

      // When existing UTXO spends the same input this is a conflict
      if (!!existing) {
        conflictingUtxos.push(i);
      }

      // Collect spends of the outpoint
      const spending = !existing ? [i] : [].concat(existing).concat(i);

      return spends[outpoint] = spending;
    });
  });

  // Look at confirmed txs and see if any unspents spend a confirmed outpoint
  transactions.forEach(tx => {
    // Exit early when there is no confirmed tx
    if (!tx.transaction || !tx.is_confirmed) {
      return;
    }

    // Look for pending inputs that are conflicted with a confirmed tx
    return fromHex(tx.transaction).ins.forEach(input => {
      const outpoint = inputAsOutpoint(txIdFromHash(input.hash), input.index);

      // Exit early when nothing pending spends this outpoint
      if (!spends[outpoint]) {
        return;
      }

      // Pending things that spend a confirmed input are invalid
      return spends[outpoint].forEach(n => invalidUtxos.push(n));
    });
  });

  const conflictingTokens = uniq(conflictingUtxos)
    .filter(utxoIndex => !invalidUtxos.includes(utxoIndex))
    .map(n => utxos[n].tokens);

  const invalidTokens = uniq(invalidUtxos).map(n => utxos[n].tokens);

  return {
    conflicting_pending_balance: sumOf(conflictingTokens),
    invalid_pending_balance: sumOf(invalidTokens),
  };
};
