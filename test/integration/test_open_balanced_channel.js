const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const test = require('node:test');

const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncRetry = require('async/retry');
const {createChainAddress} = require('ln-service');
const {fundPsbt} = require('ln-service');
const {getChannels} = require('ln-service');
const {getHeight} = require('ln-service');
const {getInvoices} = require('ln-service');
const {getNetworkGraph} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {getUtxos} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {setupChannel} = require('ln-docker-daemons');
const {signPsbt} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {openBalancedChannel} = require('./../../services');

const capacity = 1e6;
const findAddress = n => n.match(/to\ (.*)\ or/)[1];
const giveTokens = 1e6 / 2;
const interval = 10;
const log = () => {};
const many = 20000;
const maturityBlocks = 100;
const rate = 1;
const size = 2;
const slow = 100;
const times = 2000;
const tokens = 500095;

// Opening a balanced channel with a peer should open a balanced channel
test(`Open balanced channel`, async () => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [{generate, lnd}, target] = nodes;

  // Polling in the background stops once the test is finished
  let isFinished = false;

  const errorFilter = () => !isFinished;

  // Do the open balanced channel dance
  try {
    const {address} = await createChainAddress({lnd});

    // Create a channel between the two nodes so they can communicate over LN
    await setupChannel({
      capacity,
      generate,
      lnd,
      give_tokens: giveTokens,
      to: target,
    });

    // Mine coins for the target on the same chain node to avoid a chain reorg
    await generate({
      address: (await createChainAddress({lnd: target.lnd})).address,
      count: maturityBlocks,
    });

    // Make sure the nodes are synced up with each other before starting
    await asyncRetry({interval: slow, times}, async () => {
      const graph = await getNetworkGraph({lnd});

      // Nodes need to see each other in the graph to see TLV support
      if (graph.nodes.length < [lnd, target].length) {
        await generate({});

        throw new Error('ExpectedGraphNodes');
      }

      const controlChain = await getHeight({lnd});
      const targetChain = await getHeight({lnd: target.lnd});

      if (controlChain.current_block_hash !== targetChain.current_block_hash) {
        throw new Error('ExpectedSyncChain');
      }

      // Make sure the channel is active and the wallet is synced to chain
      await asyncEach([lnd, target.lnd], async lnd => {
        const {channels} = await getChannels({is_active: true, lnd});

        if (!channels.length) {
          throw new Error('ExpectedActiveChannel');
        }

        const wallet = await getWalletInfo({lnd});

        if (!wallet.is_synced_to_chain) {
          throw new Error('ExpectedWalletSyncToChain');
        }
      });

      // The target needs coins to fund its side of the channel
      if (!(await getUtxos({lnd: target.lnd})).utxos.length) {
        throw new Error('ExpectedTargetUtxos');
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
          logger: {error: log, info: log},
        });
      },

      // Wait for an incoming request on target
      waitForRequest: async () => {
        // The request will appear as a push invoice
        return await asyncRetry({errorFilter, interval, times}, async () => {
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
          logger: {error: log, info: log},
        });
      }],

      // Drive the chain forward so that the channel confirms
      waitForChannel: ['waitForRequest', async () => {
        return await asyncRetry({
          errorFilter,
          interval: slow,
          times: many,
        },
        async () => {
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

          deepEqual(addresses, [address, undefined], 'Got coop close addrs');
          deepEqual(given, [500000, 500000], 'Got coins given');

          return;
        });
      }],
    });
  } catch (err) {
    equal(err, null, 'Expected no error opening a balanced channel');
  } finally {
    isFinished = true;

    await kill({});
  }

  return;
});
