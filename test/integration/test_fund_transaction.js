const {equal} = require('node:assert').strict;
const test = require('node:test');

const {createChainAddress} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {fundTransaction} = require('./../../chain');

const count = 100;
const tokens = 1e6;

// Funding a transaction should result in a funded tx
test(`Fund transaction`, async () => {
  const {kill, nodes} = await spawnLightningCluster({});

  const [{generate, lnd}] = nodes;

  try {
    const {address} = await createChainAddress({lnd, format: 'p2tr'});

    await generate({count});

    await fundTransaction({
      lnd,
      addresses: [address],
      amounts: [tokens.toString()],
      ask: () => {},
      spend: [],
      is_dry_run: false,
      logger: {error: () => {}, info: () => {}},
      utxos: [],
    });
  } catch (err) {
    equal(err, null, 'Expected no error');
  } finally {
    await kill({});
  }
});
