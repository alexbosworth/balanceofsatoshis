const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const {spawnLightningCluster} = require('ln-docker-daemons');
const {setupChannel} = require('ln-docker-daemons');

const {removePeer} = require('./../../network');

const count = 100;
const size = 2;

// Removing a peer should close the channels with the peer
test(`Remove peer`, async () => {
  const logLines = [];
  const {kill, nodes} = await spawnLightningCluster({size});

  const [{generate, lnd}, target] = nodes;

  try {
    const channel = await setupChannel({generate, lnd, to: target});

    await removePeer({
      lnd,
      addresses: [],
      ask: () => {},
      fs: {getFile: (path, cbk) => cbk()},
      logger: {info: line => logLines.push(line)},
      outpoints: [],
      request: () => {},
    });
  } catch (err) {
    deepEqual(err, null, 'Expected no error');
  }

  await kill({});
});
