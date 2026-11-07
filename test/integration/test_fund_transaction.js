const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const test = require('node:test');

const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {broadcastChainTransaction} = require('ln-service');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {createChainAddress} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getLockedUtxos} = require('ln-service');
const {getUtxos} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {idForTransaction} = require('@alexbosworth/blockchain');
const {outputScriptForAddress} = require('@alexbosworth/blockchain');
const {sizeOfTransaction} = require('@alexbosworth/blockchain');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {fundTransaction} = require('./../../chain');
const {sortBy} = require('./../../arrays');

const {abs} = Math;
const asOutpoint = n => `${n.transaction_id}:${n.transaction_vout}`;
const asSent = n => ({address: n.address, tokens: n.tokens});
const byAddress = array => sortBy({array, attribute: 'address'}).sorted;
const count = 100;
const interval = 100;
const mtokensPerToken = 1e3;
const network = 'btcregtest';
const nodesCount = 2;
const scriptFor = address => outputScriptForAddress({address, network}).script;
const sendFeeRate = 2500;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const sweepFeeRate = 1500;
const times = 1000;
const txId = transaction => idForTransaction({transaction}).id;

// Describe a signed transaction that spends wallet coins: the coins that it
// spends, the outputs that it pays, and the fee that it pays for its size
const describeTx = ({transaction, utxos}) => {
  const {inputs, outputs} = componentsOfTransaction({transaction});
  const {vsize} = sizeOfTransaction({transaction});

  const spending = inputs.map(input => asOutpoint({
    transaction_id: input.id,
    transaction_vout: input.vout,
  }));

  const spent = utxos.filter(n => spending.includes(asOutpoint(n)));

  return {
    outputs,
    spending,
    vsize,
    fee: sumOf(spent.map(n => n.tokens)) - sumOf(outputs.map(n => n.tokens)),
    id: txId(transaction),
    is_spending_wallet_coins: spent.length === spending.length,
  };
};

// A transaction pays a fee within a vbyte of a rate in millitokens per vbyte
const isFeeAtRate = ({rate, tx}) => {
  return abs(tx.fee * mtokensPerToken - rate * tx.vsize) <= rate;
};

// Wait for the outputs that a transaction pays to a node to be confirmed
const waitForUtxos = ({id, lnd}) => {
  return asyncRetry({interval, times}, async () => {
    const {utxos} = await getUtxos({lnd});

    const confirmed = utxos
      .filter(n => n.transaction_id === id)
      .filter(n => !!n.confirmation_count);

    if (!confirmed.length) {
      throw new Error('WaitingForConfirmedUtxosOfTransaction');
    }

    return confirmed;
  });
};

// Funding a transaction should pay what was asked at the fee rate asked for
test(`Fund transaction`, async () => {
  const {kill, nodes} = await spawnLightningCluster({size: nodesCount});

  const [{generate, lnd}, target] = nodes;

  try {
    await generate({count});

    // Wait for the wallets to be synced, with confirmed coins to spend
    await asyncRetry({interval, times}, async () => {
      const [control, receiver] = await Promise.all([
        getWalletInfo({lnd}),
        getWalletInfo({lnd: target.lnd}),
      ]);

      if (!control.is_synced_to_chain || !receiver.is_synced_to_chain) {
        throw new Error('WaitingForWalletsToSyncToChain');
      }

      const {utxos} = await getUtxos({lnd});

      if (!utxos.find(n => !!n.confirmation_count)) {
        throw new Error('WaitingForConfirmedUtxoToSpend');
      }
    });

    const taproot = await createChainAddress({
      format: 'p2tr',
      lnd: target.lnd,
    });

    const witness = await createChainAddress({lnd: target.lnd});

    const logs = [];
    const wallet = await getUtxos({lnd});

    const send = [
      {address: taproot.address, tokens: 1e6},
      {address: witness.address, tokens: 25e4},
    ];

    // Send to two addresses at a fractional fee rate, broadcasting the signed
    // transaction and mining blocks until it confirms
    const sent = await asyncAuto({
      // Fund, sign, and broadcast the transaction, waiting for a confirmation
      fund: async () => {
        return await fundTransaction({
          lnd,
          addresses: send.map(n => n.address),
          amounts: send.map(n => n.tokens.toString()),
          ask: () => {},
          fee_mtokens_per_vbyte: sendFeeRate,
          is_broadcast: true,
          is_dry_run: false,
          logger: {error: () => {}, info: line => logs.push(line)},
          utxos: [],
        });
      },

      // Mine blocks until the signed transaction is confirmed
      mine: async () => {
        return await asyncRetry({interval, times}, async () => {
          const [signed] = logs.filter(n => !!n.signed_transaction);

          if (!signed) {
            throw new Error('WaitingForSignedTransaction');
          }

          await generate({});

          const id = txId(signed.signed_transaction);
          const {transactions} = await getChainTransactions({lnd});

          const tx = transactions.find(n => n.id === id && !!n.is_confirmed);

          if (!tx) {
            throw new Error('WaitingForSignedTransactionToConfirm');
          }

          return tx;
        });
      },
    });

    const [requested] = logs.filter(n => !!n.requested_fee_rate);
    const [signed] = logs.filter(n => !!n.signed_transaction);
    const [spending] = logs.filter(n => !!n.spending_utxos);

    const funded = describeTx({
      transaction: signed.signed_transaction,
      utxos: wallet.utxos,
    });

    equal(funded.is_spending_wallet_coins, true, 'Wallet coins are spent');
    deepEqual(spending.spending_utxos, funded.spending, 'Spent coins logged');

    equal(
      isFeeAtRate({rate: sendFeeRate, tx: funded}),
      true,
      'The fee is paid at the fractional fee rate'
    );

    equal(
      requested.requested_fee_rate,
      sendFeeRate / mtokensPerToken,
      'The fractional fee rate is logged as it was requested'
    );

    equal(
      signed.fee_tokens_per_vbyte,
      (funded.fee / funded.vsize).toFixed(2),
      'The fee rate that the signed transaction pays is logged'
    );

    equal(sent.mine.fee, funded.fee, 'LND agrees on the fee that was paid');

    equal(
      sent.fund.transaction_confirmed_in_block,
      sent.mine.confirmation_height,
      'The block that confirmed the transaction is returned'
    );

    const received = await waitForUtxos({id: funded.id, lnd: target.lnd});

    deepEqual(
      byAddress(received.map(asSent)),
      byAddress(send),
      'Each address is paid the amount sent to it'
    );

    const [change, ...otherChange] = await waitForUtxos({id: funded.id, lnd});

    deepEqual(otherChange, [], 'There is a single change output');

    equal(
      funded.outputs.length,
      send.length + 1,
      'Change is the only output paid that was not asked for'
    );

    // Sweeping the change coin takes the max amount it can pay to an address
    const sweep = await createChainAddress({format: 'p2tr', lnd: target.lnd});

    const coin = asOutpoint(change);
    const coins = await getUtxos({lnd});
    const sweepScript = scriptFor(sweep.address);

    const sweepArgs = {
      lnd,
      addresses: [sweep.address],
      amounts: ['max'],
      ask: () => {},
      fee_mtokens_per_vbyte: sweepFeeRate,
      logger: {error: () => {}, info: () => {}},
      utxos: [coin],
    };

    // A dry run shows the sweep without spending or holding on to the coin
    const dryRun = await fundTransaction(
      Object.assign({is_dry_run: true}, sweepArgs)
    );

    const preview = describeTx({
      transaction: dryRun.signed_transaction,
      utxos: coins.utxos,
    });

    deepEqual(preview.spending, [coin], 'Only the chosen coin is spent');

    deepEqual(
      preview.outputs,
      [{script: sweepScript, tokens: change.tokens - preview.fee}],
      'The whole coin is swept to the address, leaving no change'
    );

    equal(
      isFeeAtRate({rate: sweepFeeRate, tx: preview}),
      true,
      'The sweep pays the fractional fee rate'
    );

    equal(
      dryRun.fee_tokens_per_vbyte,
      (preview.fee / preview.vsize).toFixed(2),
      'The fee rate that the sweep pays is returned'
    );

    const afterDryRun = await getLockedUtxos({lnd});
    const unspent = await getUtxos({lnd});

    equal(
      afterDryRun.utxos.find(n => asOutpoint(n) === coin),
      undefined,
      'A dry run releases the lock on the coin'
    );

    equal(
      !!unspent.utxos.find(n => asOutpoint(n) === coin),
      true,
      'A dry run leaves the coin unspent'
    );

    // Funding for real keeps the coin locked so the signed sweep stays valid
    const funding = await fundTransaction(
      Object.assign({is_dry_run: false}, sweepArgs)
    );

    const swept = describeTx({
      transaction: funding.signed_transaction,
      utxos: coins.utxos,
    });

    deepEqual(swept.outputs, preview.outputs, 'Sweep pays what was previewed');

    const locked = await getLockedUtxos({lnd});

    equal(
      !!locked.utxos.find(n => asOutpoint(n) === coin),
      true,
      'The coin stays locked for the signed sweep'
    );

    await broadcastChainTransaction({
      lnd,
      transaction: funding.signed_transaction,
    });

    await generate({});

    const [paid, ...otherPaid] = await waitForUtxos({
      id: swept.id,
      lnd: target.lnd,
    });

    deepEqual(otherPaid, [], 'The sweep pays a single output');

    deepEqual(
      asSent(paid),
      {address: sweep.address, tokens: change.tokens - preview.fee},
      'The sweep address receives the coin less the fee'
    );

    // The swept coin is gone from the wallet once the sweep confirms
    await asyncRetry({interval, times}, async () => {
      const {utxos} = await getUtxos({lnd});

      if (!!utxos.find(n => asOutpoint(n) === coin)) {
        throw new Error('WaitingForSweptCoinToBeSpent');
      }
    });
  } catch (err) {
    equal(err, null, 'Expected no error');
  } finally {
    await kill({});
  }
});
