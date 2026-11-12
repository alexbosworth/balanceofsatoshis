const {dirname} = require('node:path');
const {join} = require('node:path');
const {readFileSync} = require('node:fs');

const asyncAuto = require('async/auto');
const {getIdentity} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {loadPackageDefinition} = require('@grpc/grpc-js');
const {loadSync} = require('@grpc/proto-loader');
const {returnResult} = require('asyncjs-util');
const {Server} = require('@grpc/grpc-js');
const {ServerCredentials} = require('@grpc/grpc-js');

const {staticAddressMethods} = require('./swap_in');
const {staticAddressServiceType} = require('./constants');
const {swapServerMethods} = require('./swap_out');
const {swapServiceType} = require('./constants');

const bindSocket = 'localhost:0';
const certPath = join(__dirname, '..', 'fixtures', 'swap_server.cert');
const confDir = join(dirname(require.resolve('goldengate')), 'grpc', 'conf');
const grpcConfigFile = 'grpc_config.json';
const keyPath = join(__dirname, '..', 'fixtures', 'swap_server.key');

/** Spawn a fake swap server for Taproot swap outs and shared address swap ins

  {
    [is_failing_fallback_sigs]: <Fail to Take Swap In Fallback Signatures Bool>
    [is_publishing_fallback]: <Publish Swap In Fallback Instead of Paying Bool>
    [is_rejecting_deposits]: <Reject Swap In Deposits Instead of Paying Bool>
    [is_uncooperative]: <Refuse to Cosign Swap Out Sweeps Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
  {
    kill: <Stop Server Function> ({}) => {}
    socket: <Swap Server Host:Port Socket String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToSpawnSwapServer']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToSpawnSwapServer']);
        }

        return cbk();
      },

      // Get the identity key of the server node
      getIdentity: ['validate', ({}, cbk) => {
        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Get the network of the server node
      getNetwork: ['validate', ({}, cbk) => {
        return getNetwork({lnd: args.lnd}, cbk);
      }],

      // Load the swap service definition that the goldengate client uses
      service: ['validate', ({}, cbk) => {
        const config = require(join(confDir, grpcConfigFile));

        const protos = config.protoFiles.map(n => join(confDir, n));

        const definition = loadSync(protos, {
          defaults: true,
          enums: String,
          includeDirs: [confDir],
          keepCase: true,
          longs: String,
          oneofs: true,
        });

        const rpc = loadPackageDefinition(definition);

        return cbk(null, {
          static: rpc[config.packageType][staticAddressServiceType].service,
          swap: rpc[config.packageType][swapServiceType].service,
        });
      }],

      // Start the server, which uses the LND node to fund, pay and sign swaps
      start: [
        'getIdentity',
        'getNetwork',
        'service',
        ({getIdentity, getNetwork, service}, cbk) =>
      {
        // The certificate is self-signed, clients trust it by its file path
        const credentials = ServerCredentials.createSsl(null, [{
          cert_chain: readFileSync(certPath),
          private_key: readFileSync(keyPath),
        }]);

        const server = new Server();

        const methods = staticAddressMethods({
          is_failing_fallback_sigs: args.is_failing_fallback_sigs,
          is_publishing_fallback: args.is_publishing_fallback,
          is_rejecting_deposits: args.is_rejecting_deposits,
          lnd: args.lnd,
          logger: args.logger,
          network: getNetwork.network,
        });

        const swapMethods = swapServerMethods({
          is_uncooperative: args.is_uncooperative,
          lnd: args.lnd,
          logger: args.logger,
          network: getNetwork.network,
          public_key: getIdentity.public_key,
        });

        server.addService(service.static, methods.static);

        server.addService(service.swap, {...swapMethods, ...methods.swap});

        return server.bindAsync(bindSocket, credentials, (err, port) => {
          if (!!err) {
            return cbk([503, 'FailedToStartSwapServer', {err}]);
          }

          return cbk(null, {
            kill: ({}) => server.forceShutdown(),
            socket: `localhost:${port}`,
          });
        });
      }],
    },
    returnResult({reject, resolve, of: 'start'}, cbk));
  });
};
