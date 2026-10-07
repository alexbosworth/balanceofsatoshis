const {equal} = require('node:assert').strict;
const test = require('node:test');

const asyncEach = require('async/each');
const asyncRetry = require('async/retry');
const {getChannels} = require('ln-service');
const {getNode} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {setupChannel} = require('ln-docker-daemons');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {rebalance} = require('./../../swaps');

const bobChannelsCount = 3;
const carolChannelsCount = 2;
const interval = 1000;
const largeCapacity = 5e6;
const largeRebalance = '2000000';
const log = () => {};
const size = 3;
const smallCapacity = 1e6;
const smallRebalance = '500000';
const times = 300;
const asTokens = bigTokens => Math.round(Number(bigTokens) * 1e8);

// Rebalancing out through a peer with multiple channels should use a fit one
test(`Rebalance out through the smallest channel that has enough`, async () => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [alice, bob, carol] = nodes;

  try {
    // Alice has a small channel and a large channel with Bob
    const small = await setupChannel({
      capacity: smallCapacity,
      generate: alice.generate,
      lnd: alice.lnd,
      to: bob,
    });

    const large = await setupChannel({
      capacity: largeCapacity,
      generate: alice.generate,
      lnd: alice.lnd,
      to: bob,
    });

    // Bob -> Carol -> Alice completes the circular route back to Alice
    await setupChannel({
      capacity: largeCapacity,
      generate: bob.generate,
      lnd: bob.lnd,
      to: carol,
    });

    await setupChannel({
      capacity: largeCapacity,
      generate: carol.generate,
      lnd: carol.lnd,
      to: alice,
    });

    // Wait for the graph to be synced so that the circular route can be found
    await asyncRetry({interval, times}, async () => {
      await asyncEach(nodes, async ({lnd}) => {
        const wallet = await getWalletInfo({lnd});

        if (!wallet.is_synced_to_chain || !wallet.is_synced_to_graph) {
          throw new Error('WaitingForSync');
        }
      });

      // Alice should see Bob with his two channels to her and one to Carol
      const bobNode = await getNode({lnd: alice.lnd, public_key: bob.id});

      if (bobNode.channels.length !== bobChannelsCount) {
        throw new Error('WaitingForBobChannelsInGraph');
      }

      // Alice should see Carol with her channels to Bob and to Alice
      const carolNode = await getNode({lnd: alice.lnd, public_key: carol.id});

      if (carolNode.channels.length !== carolChannelsCount) {
        throw new Error('WaitingForCarolChannelsInGraph');
      }
    });

    // Local balances of the channels with Bob, once no HTLCs are in flight
    const getBalances = async () => {
      const {channels} = await getChannels({lnd: alice.lnd});

      const largeChannel = channels.find(n => n.id === large.id);
      const smallChannel = channels.find(n => n.id === small.id);

      // An in-flight HTLC adds its output weight to the commit fee, which is
      // deducted from the local balance until the HTLC is resolved
      if (!!largeChannel.pending_payments.length) {
        throw new Error('WaitingForLargeChannelHtlcsToResolve');
      }

      if (!!smallChannel.pending_payments.length) {
        throw new Error('WaitingForSmallChannelHtlcsToResolve');
      }

      return {
        large: largeChannel.local_balance,
        small: smallChannel.local_balance,
      };
    };

    const initial = await asyncRetry({interval, times}, getBalances);

    // The small channel can send the probe but not the amount being looked for
    const first = await rebalance({
      avoid: [],
      fs: {getFile: (path, cbk) => cbk()},
      in_through: carol.id,
      lnd: alice.lnd,
      logger: {error: log, info: log, warn: log},
      max_rebalance: largeRebalance,
      out_through: bob.id,
    });

    const [, , firstResult] = first.rebalance;

    // Wait for the settled payment to be reflected in the channel balances
    const afterFirst = await asyncRetry({interval, times}, async () => {
      const balances = await getBalances();

      if (balances.large === initial.large) {
        throw new Error('WaitingForLargeChannelBalanceToChange');
      }

      return balances;
    });

    const firstSent = initial.large - afterFirst.large;
    const firstTotal = asTokens(firstResult.rebalanced);

    equal(afterFirst.small, initial.small, 'Small channel is not used');
    equal(firstTotal > smallCapacity, true, 'Rebalanced more than small cap');
    equal(firstSent >= firstTotal, true, 'Large channel sent the rebalance');

    // The small channel can send the amount being looked for, so it is used
    const second = await rebalance({
      avoid: [],
      fs: {getFile: (path, cbk) => cbk()},
      in_through: carol.id,
      lnd: alice.lnd,
      logger: {error: log, info: log, warn: log},
      max_rebalance: smallRebalance,
      out_through: bob.id,
    });

    const [, , secondResult] = second.rebalance;

    const afterSecond = await asyncRetry({interval, times}, async () => {
      const balances = await getBalances();

      if (balances.small === afterFirst.small) {
        throw new Error('WaitingForSmallChannelBalanceToChange');
      }

      return balances;
    });

    const secondSent = afterFirst.small - afterSecond.small;
    const secondTotal = asTokens(secondResult.rebalanced);

    equal(afterSecond.large, afterFirst.large, 'Large channel is not used');
    equal(secondSent >= secondTotal, true, 'Small channel sent the rebalance');
  } finally {
    // Always stop the cluster, including when an assertion fails
    await kill({});
  }

  return;
});
