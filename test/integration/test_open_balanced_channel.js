const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncRetry = require('async/retry');
const {addPeer} = require('ln-service');
const {createChainAddress} = require('ln-service');
const {fundPsbt} = require('ln-service');
const {getChainBalance} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getChannels} = require('ln-service');
const {getHeight} = require('ln-service');
const {getInvoices} = require('ln-service');
const {getNetworkGraph} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {getUtxos} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {openChannel} = require('ln-service');
const {removePeer} = require('ln-service');
const {signPsbt} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');
const {stopDaemon} = require('ln-service');
const {test} = require('@alexbosworth/tap');

const {openBalancedChannel} = require('./../../services');

const capacity = 1e6;
const findAddress = n => n.match(/to\ (.*)\ or/)[1];
const giveTokens = 1e6 / 2;
const info = () => {};
const interval = 10;
const many = 20000;
const maturityBlocks = 100;
const rate = 1;
const size = 2;
const slow = 100;
const times = 2000;
const tokens = 500095;

// Opening a balanced channel with a peer should open a balanced channel
test(`Open balanced channel`, async ({end, equal, strictSame}) => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [{generate, lnd}, target] = nodes;

  // Do the open balanced channel dance
  try {
    // Generate some coins for each side
    await asyncEach([generate, target.generate], async generate => {
      return await generate({count: maturityBlocks});
    });

    const {address} = await createChainAddress({lnd});

    // Create a channel between the two nodes so they can communicate over LN
    await openChannel({
      lnd,
      give_tokens: giveTokens,
      local_tokens: capacity,
      partner_public_key: target.id,
      partner_socket: target.socket,
    });

    // Make sure the channel is open and the wallet is sync'ed to chain
    await asyncEach([lnd, target.lnd], async lnd => {
      await asyncRetry(({interval, times}), async () => {
        await generate({});
        await target.generate({});

        const {channels} = await getChannels({lnd});

        if (!channels.length) {
          throw new Error('ExpectedChannel');
        }

        const [channel] = channels;

        if (!channel.is_active) {
          throw new Error('ExpectedActiveChannel');
        }

        const wallet = await getWalletInfo({lnd});

        if (!wallet.is_synced_to_chain) {
          throw new Error('ExpectedWalletSyncToChain');
        }
      });
    });

    // Make sure that the nodes see each other in the graph to see TLV support
    await asyncRetry(({interval, times}), async () => {
      const graph = await getNetworkGraph({lnd});

      // Force graph resync in case it gets stuck
      try {
        await removePeer({lnd, public_key: target.id});
      } catch (err) {}

      await addPeer({lnd, public_key: target.id, socket: target.socket});

      if (graph.nodes.length < [lnd, target].length) {
        throw new Error('ExpectedGraphNodes');
      }
    });

    // Make sure nodes are on the same chain hash and the channels are active
    await asyncRetry(({interval, times}), async () => {
      const controlChain = await getHeight({lnd});
      const targetChain = await getHeight({lnd: target.lnd});

      if (controlChain.current_block_hash !== targetChain.current_block_hash) {
        throw new Error('ExpectedSyncChain');
      }

      await addPeer({lnd, public_key: target.id, socket: target.socket});

      const [channel] = (await getChannels({lnd: target.lnd})).channels;

      if (!channel.is_active) {
        throw new Error('ExpectedActiveChannelForSetup');
      }
    });

    // Get UTXOs to be spent into the balanced channel
    const controlUtxos = (await getUtxos({lnd})).utxos;
    const {utxos} = await getUtxos({lnd: target.lnd});

    await asyncAuto({
      // Start proposing the channel
      initiate: async () => {
        return await openBalancedChannel({
          lnd,
          address,
          ask: (args, cbk) => {
            // Propose the capacity
            if (args.name === 'capacity') {
              return cbk({capacity});
            }

            // Provide funding
            if (args.name === 'fund') {
              // Scrape the address out of the query
              const address = findAddress(args.message);
              const [utxo] = controlUtxos;

              // Use an old UTXO to fund the PSBT
              return fundPsbt({
                lnd,
                inputs: [utxo],
                outputs: [{address, tokens}],
              },
              (err, res) => {
                if (!!err) {
                  throw err;
                }

                const {psbt} = res;

                return signPsbt({lnd, psbt}, (err, res) => {
                  if (!!err) {
                    throw err;
                  }

                  return cbk({fund: res.transaction});
                });
              });
            }

            // Use external funding
            if (args.name === 'internal') {
              return cbk({internal: false});
            }

            // Make channel to target
            if (args.name === 'key') {
              return cbk({key: target.id});
            }

            // Use standard fee rate
            if (args.name === 'rate') {
              return cbk({rate});
            }

            throw new Error('UnknownAskQuery');
          },
          logger: {info, error: err => { throw err; }},
        });
      },

      // Wait for an incoming request on target
      waitForRequest: async () => {
        // The request will appear as a push invoice
        return await asyncRetry(({interval, times}), async () => {
          const {invoices} = await getInvoices({lnd: target.lnd});

          if (!invoices.length) {
            throw new Error('WaitingForProposal');
          }

          return;
        });
      },

      // Accept the balanced channel request
      acceptRequest: ['waitForRequest', async () => {
        return await openBalancedChannel({
          lnd: target.lnd,
          ask: (args, cbk) => {
            // Accept the proposal
            if (args.name === 'accept') {
              return cbk({accept: true});
            }

            // Provide for funding
            if (args.name === 'fund') {
              const address = findAddress(args.message);
              const [utxo] = utxos;

              return fundPsbt({
                inputs: [utxo],
                lnd: target.lnd,
                outputs: [{address, tokens}],
              },
              (err, res) => {
                const {psbt} = res;

                return signPsbt({psbt, lnd: target.lnd}, (err, res) => {
                  return cbk({fund: res.transaction});
                });
              });
            }

            // Use external funding
            if (args.name === 'internal') {
              return cbk({internal: false});
            }

            throw new Error('UnknownAskQuery');
          },
          logger: {info, error: err => { throw err; }},
        });
      }],

      // Drive the chain forward so that the channel confirms
      waitForChannel: ['waitForRequest', async () => {
        return await asyncRetry(({interval: slow, times: many}), async () => {
          const {channels} = await getChannels({lnd});
          const opening = (await getPendingChannels({lnd})).pending_channels;

          if (!!opening.length || channels.length === [lnd, target.length]) {
            await generate({});
          }

          // Make sure the new channel is active
          if (channels.filter(n => n.is_active).length < [lnd, lnd].length) {
            throw new Error('WaitingForMoreChannels');
          }

          const addresses = channels.map(n => n.cooperative_close_address);
          const given = channels.map(n => n.local_given);

          addresses.sort();
          given.sort();

          strictSame(addresses, [address, undefined], 'Got coop close addrs');
          strictSame(given, [500000, 500000], 'Got coins given');

          return;
        });
      }],
    });
  } catch (err) {
    equal(err, null, 'Expected no error opening a balanced channel');
  } finally {
    await kill({});
  }

  return end();
});
