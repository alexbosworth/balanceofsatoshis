const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const test = require('node:test');

const asyncEach = require('async/each');
const asyncEachSeries = require('async/eachSeries');
const asyncRetry = require('async/retry');
const {closeChannel} = require('ln-service');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {getChainTransactions} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getHeight} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {setupChannel} = require('ln-docker-daemons');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {getChannelCloses} = require('./../../chain');

const capacity = 1e6;
const closesCount = 2;
const giveTokens = 1e5;
const interval = 200;
const outpointOf = n => `${n.transaction_id}:${n.transaction_vout}`;
const size = 2;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const times = 1000;

// Getting channel closes should return the details of closed channels
test(`Get channel closes`, async () => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [{generate, lnd}, target] = nodes;

  try {
    // Open a channel that the opener will close
    const openerChannel = await setupChannel({
      capacity,
      generate,
      lnd,
      give_tokens: giveTokens,
      to: target,
    });

    // Open a channel that the peer will close
    const peerChannel = await setupChannel({
      capacity,
      generate,
      lnd,
      give_tokens: giveTokens,
      to: target,
    });

    // Before the channels are closed there are no closes
    deepEqual(await getChannelCloses({lnd}), {closes: []}, 'No closes');

    // Cooperatively close the channels
    const openerClosing = await asyncRetry({interval, times}, async () => {
      return await closeChannel({lnd, id: openerChannel.id});
    });

    const peerClosing = await asyncRetry({interval, times}, async () => {
      return await closeChannel({id: peerChannel.id, lnd: target.lnd});
    });

    // Wait for the closes to confirm on both nodes
    await asyncRetry({interval, times}, async () => {
      await generate({});

      await asyncEach(nodes, async node => {
        const {channels} = await getClosedChannels({lnd: node.lnd});

        if (channels.length !== closesCount) {
          throw new Error('WaitingForChannelCloses');
        }
      });
    });

    // Wait for the node to be synced to the tip so the height is stable
    await asyncRetry({interval, times}, async () => {
      const wallet = await getWalletInfo({lnd});

      if (!wallet.is_synced_to_chain) {
        throw new Error('WaitingForSyncToChain');
      }
    });

    const {closes} = await getChannelCloses({lnd});

    const height = (await getHeight({lnd})).current_block_height;

    const {channels} = await getClosedChannels({lnd});

    const closedChannel = channels.find(channel => {
      return channel.close_transaction_id === openerClosing.transaction_id;
    });

    // The opener has an output in each close tx so it has the raw close txs
    const {transactions} = await getChainTransactions({lnd});

    // The close fee is the capacity not paid out in the close tx outputs
    const [openerCloseFee, peerCloseFee] = [openerClosing, peerClosing]
      .map(closing => transactions.find(n => n.id === closing.transaction_id))
      .map(({transaction}) => componentsOfTransaction({transaction}))
      .map(({outputs}) => capacity - sumOf(outputs.map(n => n.tokens)));

    equal(openerCloseFee > 0, true, 'The opener close paid a chain fee');
    equal(peerCloseFee > 0, true, 'The peer close paid a chain fee');

    const openerCloseDetails = closes.find(details => {
      return details.channel_close === openerClosing.transaction_id;
    });

    // The peer alias depends on the graph so it is not checked
    deepEqual(openerCloseDetails, {
      capacity,
      blocks_since_close: height - closedChannel.close_confirm_height,
      channel_balance_spend: undefined,
      channel_close: openerClosing.transaction_id,
      channel_id: openerChannel.id,
      channel_open: outpointOf(openerChannel),
      channel_resolutions: undefined,
      closing_fee_paid: openerCloseFee,
      is_breach_close: undefined,
      is_closing_fee_unknown: undefined,
      is_cooperative_close: true,
      is_local_force_close: undefined,
      is_remote_force_close: undefined,
      peer_alias: openerCloseDetails.peer_alias,
      peer_closed_channel: undefined,
      peer_opened_channel: undefined,
      peer_public_key: target.id,
    },
    'Got channel close');

    // The opener pays the fee in a legacy cooperative close
    const views = [
      {
        lnd,
        description: 'Opener view of the close by the opener',
        fee: openerCloseFee,
        final_local_balance: capacity - giveTokens - openerCloseFee,
        is_partner_closed: false,
        is_partner_initiated: false,
        transaction_id: openerClosing.transaction_id,
      },
      {
        lnd,
        description: 'Opener view of the close by the peer',
        fee: peerCloseFee,
        final_local_balance: capacity - giveTokens - peerCloseFee,
        is_partner_closed: true,
        is_partner_initiated: false,
        transaction_id: peerClosing.transaction_id,
      },
      {
        description: 'Peer view of the close by the opener',
        fee: undefined,
        final_local_balance: giveTokens,
        is_partner_closed: true,
        is_partner_initiated: true,
        lnd: target.lnd,
        transaction_id: openerClosing.transaction_id,
      },
      {
        description: 'Peer view of the close by the peer',
        fee: undefined,
        final_local_balance: giveTokens,
        is_partner_closed: false,
        is_partner_initiated: true,
        lnd: target.lnd,
        transaction_id: peerClosing.transaction_id,
      },
    ];

    await asyncEachSeries(views, async view => {
      const viewChannels = (await getClosedChannels({lnd: view.lnd})).channels;

      const channel = viewChannels.find(viewChannel => {
        return viewChannel.close_transaction_id === view.transaction_id;
      });

      // What LND reports through ln-service about who opened and closed
      equal(
        channel.is_partner_initiated,
        view.is_partner_initiated,
        `${view.description}: opener is reported correctly`
      );

      equal(
        channel.is_partner_closed,
        view.is_partner_closed,
        `${view.description}: closer is reported correctly`
      );

      // The node that did not pay the fee keeps its full balance on chain
      equal(
        channel.final_local_balance,
        view.final_local_balance,
        `${view.description}: final balance shows who paid the fee`
      );

      const nodeCloses = (await getChannelCloses({lnd: view.lnd})).closes;

      const details = nodeCloses.find(nodeClose => {
        return nodeClose.channel_close === view.transaction_id;
      });

      equal(
        details.closing_fee_paid,
        view.fee,
        `${view.description}: closing fee paid`
      );

      equal(
        details.is_closing_fee_unknown,
        undefined,
        `${view.description}: closing fee is known`
      );

      equal(
        details.peer_opened_channel,
        view.is_partner_initiated || undefined,
        `${view.description}: channel opener is shown`
      );
    });
  } catch (err) {
    equal(err, null, 'Expected no error');
  } finally {
    await kill({});
  }
});
