const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const {promisify} = require('node:util');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const asyncRetry = require('async/retry');
const {createChainAddress} = require('ln-service');
const {getLockedUtxos} = require('ln-service');
const {getUtxos} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {sendToChainAddresses} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {splitUtxos} = require('./../../chain');

const asOutpoint = n => `${n.transaction_id}:${n.transaction_vout}`;
const count = 100;
const insufficient = [400, 'InsufficientBalanceToSplitUtxos'];
const interval = 200;
const isHash = n => /^[0-9A-F]{64}$/i.test(n);
const largeTokens = 15e5;
const nodesCount = 2;
const size = 1e6;
const smallTokens = 6e5;
const split = promisify(splitUtxos);
const times = 1000;

// Count the utxos that are at least as large as the split size
const countLarge = ({utxos}) => utxos.filter(n => n.tokens >= size).length;

// Send amounts to new addresses of a node and wait for them to confirm
const sendToNode = async ({amounts, generate, lnd, to}) => {
  const sendTo = await Promise.all(amounts.map(async tokens => {
    const {address} = await createChainAddress({lnd: to});

    return {address, tokens};
  }));

  const {id} = await sendToChainAddresses({lnd, send_to: sendTo});

  return await asyncRetry({interval, times}, async () => {
    await generate({});

    const {utxos} = await getUtxos({lnd: to});

    const confirmed = utxos
      .filter(n => n.transaction_id === id)
      .filter(n => !!n.confirmation_count);

    if (confirmed.length !== amounts.length) {
      throw new Error('WaitingForConfirmedFundsSentToNode');
    }
  });
};

// Splitting utxos that already count should replace them to reach the count
test(`Split utxos spending counted utxos`, async () => {
  const {kill, nodes} = await spawnLightningCluster({size: nodesCount});

  const [{generate, lnd}, target] = nodes;

  try {
    await generate({count});

    // Wait for the funding wallet to be synced with spendable funds
    await asyncRetry({interval, times}, async () => {
      const wallet = await getWalletInfo({lnd});

      if (!wallet.is_synced_to_chain) {
        throw new Error('WaitingForSyncToChain');
      }

      const {utxos} = await getUtxos({lnd});

      if (!utxos.find(n => !!n.confirmation_count && n.tokens >= size)) {
        throw new Error('WaitingForConfirmedUtxo');
      }
    });

    // The target starts with two utxos that are counted
    await sendToNode({
      generate,
      lnd,
      amounts: [largeTokens, largeTokens],
      to: target.lnd,
    });

    const funded = await getUtxos({lnd: target.lnd});

    equal(countLarge(funded), 2, 'Target has two counted utxos');

    // Splitting a counted utxo leaves too little change to count as a utxo
    await rejects(
      split({size, count: 3, is_dry_run: true, lnd: target.lnd}),
      insufficient,
      'A dry run is rejected when a split only replaces the spent utxo'
    );

    await rejects(
      split({size, count: 3, lnd: target.lnd}),
      insufficient,
      'A split is rejected when it only replaces the spent utxo'
    );

    const {utxos} = await getUtxos({lnd: target.lnd});

    deepEqual(
      utxos.map(asOutpoint).sort(),
      funded.utxos.map(asOutpoint).sort(),
      'A rejected split does not spend any utxos'
    );

    const locked = await getLockedUtxos({lnd: target.lnd});

    deepEqual(locked.utxos, [], 'A rejected split does not lock any utxos');

    // A utxo that is too small to count can fund replacing a spent utxo
    await sendToNode({generate, lnd, amounts: [smallTokens], to: target.lnd});

    await rejects(
      split({size, count: 4, lnd: target.lnd}),
      insufficient,
      'A split is rejected when funds cannot support the requested count'
    );

    const dryRun = await split({
      size,
      count: 3,
      is_dry_run: true,
      lnd: target.lnd,
    });

    deepEqual(
      dryRun,
      {needed_outputs: 1, sent_to: [], transaction_id: undefined},
      'A dry run returns the output needed to reach the count'
    );

    const res = await split({size, count: 3, lnd: target.lnd});

    equal(res.needed_outputs, 1, 'Split into the needed output');
    equal(res.sent_to.length, 1, 'Sent to an address for the output');
    equal(isHash(res.transaction_id), true, 'Got split transaction id');

    // Confirm the split transaction
    const settled = await asyncRetry({interval, times}, async () => {
      await generate({});

      const {utxos} = await getUtxos({lnd: target.lnd});

      const confirmed = utxos
        .filter(n => n.transaction_id === res.transaction_id)
        .filter(n => !!n.confirmation_count);

      if (!confirmed.length) {
        throw new Error('WaitingForConfirmedSplitOutputs');
      }

      return {utxos};
    });

    const outputs = settled.utxos
      .filter(n => n.transaction_id === res.transaction_id)
      .filter(n => n.tokens === size);

    deepEqual(
      outputs.map(n => n.address),
      res.sent_to,
      'Split output of the requested size pays to the created address'
    );

    equal(countLarge(settled), 3, 'Split reaches the requested count');
    equal(settled.utxos.length, 3, 'The small utxo was spent in the split');

    const noSplit = await split({size, count: 3, lnd: target.lnd});

    deepEqual(
      noSplit,
      {needed_outputs: 0, sent_to: [], transaction_id: undefined},
      'Nothing is sent when there are already enough utxos'
    );
  } catch (err) {
    equal(err, null, 'Expected no error');
  } finally {
    await kill({});
  }
});
