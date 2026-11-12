const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncRetry = require('async/retry');
const {authenticatedLndGrpc} = require('ln-service');
const {createChainAddress} = require('ln-service');
const {getUtxos} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {spawnLightningDocker} = require('ln-docker-daemons');

const generateAddress = '2N8hwP1WmJrFF5QWABn38y63uYLhnJYJYTF';
const interval = 10;
const maturity = 100;
const nodesCount = 2;
const started = spawned => spawned.filter(n => !!n.value).map(n => n.value);
const stopNode = (node, cbk) => node.kill({}, () => cbk());
const times = 3000;

const stopNodes = (nodes, cbk) => asyncEach(nodes, stopNode, cbk);

/** Spawn a client node and a swap server node with their LND credentials

  {}

  @returns via cbk or Promise
  {
    client: {
      cert: <LND Base64 Serialized TLS Cert String>
      generate: <Make Blocks Function> ({[count]}) => <Promise>
      id: <Node Public Key Hex String>
      lnd: <Authenticated LND API Object>
      macaroon: <LND Base64 Serialized Macaroon String>
      rpc_socket: <LND RPC Host:Port Network Address String>
      socket: <Lightning Peer to Peer Socket String>
    }
    kill: <Stop Nodes Function> ({}) => <Promise>
    server: {
      cert: <LND Base64 Serialized TLS Cert String>
      generate: <Make Blocks Function> ({[count]}) => <Promise>
      id: <Node Public Key Hex String>
      lnd: <Authenticated LND API Object>
      macaroon: <LND Base64 Serialized Macaroon String>
      rpc_socket: <LND RPC Host:Port Network Address String>
      socket: <Lightning Peer to Peer Socket String>
    }
  }
*/
module.exports = ({}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Spawn the nodes, stopping the ones that started when one fails
      spawn: cbk => {
        const spawning = [...Array(nodesCount)].map(() => {
          return spawnLightningDocker({generate_address: generateAddress});
        });

        return Promise.allSettled(spawning).then(spawned => {
          const failure = spawned.find(n => n.status === 'rejected');

          // Exit early when every node started
          if (!failure) {
            return cbk(null, started(spawned));
          }

          return stopNodes(started(spawned), () => {
            return cbk([503, 'FailedToSpawnSwapNodes', {err: failure.reason}]);
          });
        });
      },

      // Connect the chain daemons so blocks mined by one node reach the other
      connect: ['spawn', ({spawn}, cbk) => {
        const [client, server] = spawn;

        return client.add_chain_peer({socket: server.chain_socket}).then(
          () => cbk(),
          err => cbk([503, 'FailedToConnectSwapNodesChains', {err}])
        );
      }],

      // Nodes with their credentials and block generation functions
      nodes: ['connect', 'spawn', ({spawn}, cbk) => {
        const [client, server] = spawn.map(docker => {
          const {lnd} = authenticatedLndGrpc({
            cert: docker.cert,
            macaroon: docker.macaroon,
            socket: docker.socket,
          });

          // Mine blocks to the node, waiting for a utxo when coins mature
          const generate = async ({count}) => {
            const {address} = await createChainAddress({lnd});

            await docker.generate({address, count});

            // Exit early when there are not enough blocks to mature coins
            if (!count || count < maturity) {
              return;
            }

            await asyncRetry({interval, times}, async () => {
              const {utxos} = await getUtxos({lnd});

              if (!utxos.length) {
                throw new Error('ExpectedUtxoAfterGeneratingMatureBlocks');
              }
            });
          };

          // Credentials let a swap run in another process that can be killed
          return {
            generate,
            lnd,
            cert: docker.cert,
            id: docker.public_key,
            macaroon: docker.macaroon,
            rpc_socket: docker.socket,
            socket: docker.ln_socket,
          };
        });

        return cbk(null, {
          client,
          server,
          kill: ({}) => asyncEach(spawn, ({kill}, cbk) => kill({}, cbk)),
        });
      }],
    },
    (err, res) => {
      // Stop the nodes that started when they cannot be connected
      if (!!err && !!res && !!res.spawn) {
        return stopNodes(res.spawn, () => {
          return returnResult({reject, resolve}, cbk)(err);
        });
      }

      return returnResult({reject, resolve, of: 'nodes'}, cbk)(err, res);
    });
  });
};
