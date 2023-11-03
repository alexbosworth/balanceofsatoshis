const {equal} = require('node:assert').strict;
const test = require('node:test');

const {addPeer} = require('ln-service');
const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncRetry = require('async/retry');
const {createChainAddress} = require('ln-service');
const {fundPsbt} = require('ln-service');
const {getChannels} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {openChannel} = require('ln-service');
const {signPsbt} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');
const {Transaction} = require('bitcoinjs-lib');

const {openChannels} = require('./../../peers');

const count = 100;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const interval = 200;
const log = () => {};
const size = 2;
const times = 20;

// Opening taproot channels should open channels with specified nodes
test(`Open taproot channels`, async () => {
  const {kill, nodes} = await spawnLightningCluster({
    size,
    lnd_configuration: [
      '--maxpendingchannels=10',
      '--protocol.option-scid-alias',
      '--protocol.simple-taproot-chans',
    ],
  });

  const [{generate, id, lnd}, target] = nodes;

  try {
    await generate({count});

    await asyncRetry({interval, times}, async () => {
      await addPeer({lnd, public_key: target.id, socket: target.socket});

      await asyncEach(nodes, async ({lnd}) => {
        const chain = await getWalletInfo({lnd});

        if (!chain.is_synced_to_chain || !chain.is_synced_to_graph) {
          throw new Error('WaitingForSync');
        }
      });
    });

    const {address} = await asyncRetry({interval, times}, async () => {
      return await createChainAddress({lnd});
    });

    // Propose a taproot channel
    await asyncAuto({
      // Propose the taproot channel to target
      propose: async () => {
        return asyncRetry({interval, times}, async () => {
          await addPeer({lnd, public_key: target.id, socket: target.socket});

          await openChannels({
            lnd,
            ask: async (args, cbk) => {
              if (args.name === 'internal') {
                return cbk({internal: false});
              }

              if (args.name === 'fund') {
                const address = args.message.split(' ')[9];
                const amount = args.message.split(' ')[7];

                // Provide funding
                const {psbt} = await fundPsbt({
                  lnd,
                  outputs: [{address, tokens: amount * 1e8}],
                });

                const signed = await signPsbt({lnd, psbt});

                return cbk({fund: signed.psbt});
              }

              throw new Error('UnrecognizedParameter');
            },
            capacities: [],
            cooperative_close_addresses: [],
            fs: {getFile: () => {}},
            gives: [],
            logger: {info: log, error: log},
            opening_nodes: [],
            public_keys: [target.id],
            request: () => {},
            set_fee_rates: [],
            types: ['private'],
            channel_types: ['taproot']
          });
        });
      },

      // Generate blocks until the channel confirms
      generate: async () => {
        return await asyncRetry({interval, times}, async () => {
          await generate({});

          const {channels} = await getChannels({lnd});

          if (!channels.length) {
            throw new Error('Expected Channels');
          }

          const [channel] = channels;

          equal(channel.type, 'simplified_taproot', 'Taproot channel opened');
        });
      },

      // Stop the target node
      finish: ['generate', 'propose', async ({}) => {
        await target.kill({});
      }],
    });
  } catch (err) {
    equal(err, null, 'Expected no error');
  }

  await kill({});
});
