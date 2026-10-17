const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const {promisify} = require('node:util');
const test = require('node:test');

const asyncRetry = require('async/retry');
const {getUtxos} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {splitUtxos} = require('./../../chain');

const asOutpoint = n => `${n.transaction_id}:${n.transaction_vout}`;
const count = 100;
const fanout = 3;
const interval = 200;
const isHash = n => /^[0-9A-F]{64}$/i.test(n);
const size = 1e6;
const split = promisify(splitUtxos);
const times = 1000;
const tokensPerVbyte = 2;

// Get the utxos that are at least as large as the split size
const largeUtxos = ({utxos}) => utxos.filter(n => n.tokens >= size);

// Splitting utxos should fan out new utxos of the requested size
test(`Split utxos`, async () => {
  const {kill, nodes} = await spawnLightningCluster({});

  const [{generate, lnd}] = nodes;

  try {
    await generate({count});

    // Wait for the wallet to be synced with spendable funds
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

    const existing = largeUtxos(await getUtxos({lnd}));

    // A large coinbase utxo is spent, and its large change replaces it
    const target = existing.length + fanout;

    const dryRun = await split({lnd, size, count: target, is_dry_run: true});

    deepEqual(
      dryRun,
      {needed_outputs: fanout, sent_to: [], transaction_id: undefined},
      'A dry run returns the needed outputs without sending'
    );

    const res = await split({
      lnd,
      size,
      count: target,
      tokens_per_vbyte: tokensPerVbyte,
    });

    equal(res.needed_outputs, fanout, 'Split into needed outputs');
    equal(res.sent_to.length, fanout, 'Sent to an address for each output');
    equal(isHash(res.transaction_id), true, 'Got split transaction id');

    // Confirm the split transaction
    const {utxos} = await asyncRetry({interval, times}, async () => {
      await generate({});

      const {utxos} = await getUtxos({lnd});

      const confirmed = utxos
        .filter(n => n.transaction_id === res.transaction_id)
        .filter(n => !!n.confirmation_count);

      if (!confirmed.length) {
        throw new Error('WaitingForConfirmedSplitOutputs');
      }

      return {utxos};
    });

    const outputs = utxos.filter(n => n.transaction_id === res.transaction_id);

    deepEqual(
      outputs.filter(n => n.tokens === size).map(n => n.address).sort(),
      res.sent_to.slice().sort(),
      'Split outputs of the requested size pay to the created addresses'
    );

    // Coinbase utxos mature as blocks are mined, so only count known utxos
    const known = existing.map(asOutpoint);

    const remaining = largeUtxos({utxos}).filter(utxo => {
      return known.includes(asOutpoint(utxo));
    });

    const created = largeUtxos({utxos: outputs});

    equal(remaining.length, existing.length - 1, 'A large utxo was spent');
    equal(created.length, fanout + 1, 'Large change counts as a new utxo');
    equal(remaining.length + created.length, target, 'Split reaches count');

    // Asking for no more utxos than exist should not send anything
    const enough = largeUtxos(await getUtxos({lnd})).length;

    const noSplit = await split({lnd, size, count: enough});

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
