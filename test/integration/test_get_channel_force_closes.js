const {equal} = require('node:assert').strict;
const test = require('node:test');

const asyncRetry = require('async/retry');
const {closeChannel} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {setupChannel} = require('ln-docker-daemons');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {getChannelCloses} = require('./../../chain');

const capacity = 1e6;
const interval = 200;
const size = 2;
const times = 1000;

// Getting channel closes should return how force closed outputs resolved
test(`Get channel force closes`, async () => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [{generate, lnd}, target] = nodes;

  try {
    const channel = await setupChannel({capacity, generate, lnd, to: target});

    // The peer force closes the channel
    const closing = await asyncRetry({interval, times}, async () => {
      return await closeChannel({
        id: channel.id,
        is_force_close: true,
        lnd: target.lnd,
      });
    });

    // Wait for the balance on the peer's commitment to get swept
    await asyncRetry({interval, times}, async () => {
      await generate({});

      const {channels} = await getClosedChannels({lnd});

      if (!channels.find(n => !!n.close_balance_spent_by)) {
        throw new Error('WaitingForBalanceSweep');
      }
    });

    const [forceClose] = (await getChannelCloses({lnd})).closes;

    const sweepTxId = forceClose.channel_balance_spend;

    equal(forceClose.capacity, capacity, 'Got force close capacity');
    equal(forceClose.channel_close, closing.transaction_id, 'Got close tx');
    equal(forceClose.channel_id, channel.id, 'Got force closed channel id');
    equal(forceClose.is_cooperative_close, undefined, 'Not cooperative');
    equal(forceClose.is_remote_force_close, true, 'Peer force closed channel');
    equal(forceClose.peer_closed_channel, true, 'Peer closed the channel');
    equal(forceClose.peer_opened_channel, undefined, 'Channel opened locally');

    // The opener paid the commitment fee so the fee is never reported as none
    const isFeeReported = !!forceClose.closing_fee_paid;
    const isFeeUnknown = !!forceClose.is_closing_fee_unknown;

    equal(isFeeReported || isFeeUnknown, true, 'Fee is reported or unknown');
    equal(forceClose.peer_public_key, target.id, 'Got force close peer key');

    const sweep = forceClose.channel_resolutions.find(resolution => {
      return resolution.type === 'balance_swept';
    });

    equal(sweep.transaction_id, sweepTxId, 'Balance sweep is a resolution');
  } catch (err) {
    equal(err, null, 'Expected no error');
  } finally {
    await kill({});
  }
});
