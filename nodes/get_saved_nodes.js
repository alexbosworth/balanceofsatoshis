const {homedir} = require('os');
const {join} = require('path');

const asyncAuto = require('async/auto');
const asyncFilter = require('async/filter');
const asyncMap = require('async/map');
const {authenticatedLndGrpc} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const getSavedCredentials = require('./get_saved_credentials');
const {home} = require('../storage');

/** Get a list of saved nodes

  {
    fs: {
      getDirectoryFiles: <Read Directory Contents Function> (path, cbk) => {}
      getFile: <Read File Contents Function> (path, cbk) => {}
      getFileStatus: <File Status Function> (path, cbk) => {}
    }
    [network]: <Required Network Name String>
  }

  @returns via cbk or Promise
  {
    nodes: [{
      [is_online]: <Node is Online Bool>
      lnd: <Authenticated LND API Object>
      node_name: <Node Name String>
      public_key: <Node Identity Public Key Hex String>
    }]
  }
*/
module.exports = ({fs, network}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFileSystemMethods']);
        }

        if (!fs.getDirectoryFiles) {
          return cbk([400, 'ExpectedGetDirectoryFilesMethod']);
        }

        if (!fs.getFile) {
          return cbk([400, 'ExpectedReadFileFunction']);
        }

        if (!fs.getFileStatus) {
          return cbk([400, 'ExpectedReadFileStatusFunction']);
        }

        return cbk();
      },

      // Data directory
      dataDir: ['validate', ({}, cbk) => {
        return cbk(null, join(...[homedir(), home()]));
      }],

      // Check that the data directory exists
      checkDataDir: ['dataDir', ({dataDir}, cbk) => {
        return fs.getFileStatus(dataDir, (err, res) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrCheckingForDataDirectory', {err}]);
          }

          if (!res.isDirectory()) {
            return cbk([400, 'FailedToFindHomeDataDirectory']);
          }

          return cbk();
        });
      }],

      // Get the sub directories in the data directory
      getDirs: ['checkDataDir', 'dataDir', ({dataDir}, cbk) => {
        return fs.getDirectoryFiles(dataDir, (err, files) => {
          return asyncFilter(files, (file, cbk) => {
            const path = join(...[homedir(), home(), file]);

            return fs.getFileStatus(path, (err, res) => {
              if (!!err) {
                return cbk([503, 'UnexpectedErrCheckingForNodeDir', {err}]);
              }

              return cbk(null, res.isDirectory());
            });
          },
          cbk);
        });
      }],

      // Get node credentials
      getNodeCredentials: ['getDirs', ({getDirs}, cbk) => {
        return asyncMap(getDirs, (node, cbk) => {
          return getSavedCredentials({fs, node}, cbk);
        },
        cbk);
      }],

      // Get node info
      getNodes: ['getNodeCredentials', ({getNodeCredentials}, cbk) => {
        return asyncMap(getNodeCredentials, ({credentials, node}, cbk) => {
          if (!credentials) {
            return cbk([400, 'InvalidCredentialsForNode', {node}]);
          }

          if (!credentials.macaroon) {
            return cbk(null, {
              node_name: node,
              locked_to_keys: credentials.encrypted_to,
            });
          }

          const {lnd} = authenticatedLndGrpc(credentials);

          return getWalletInfo({lnd}, (err, res) => {
            if (!!err) {
              return cbk(null, {node_name: node});
            }

            return cbk(null, {
              lnd,
              is_online: res.is_synced_to_chain,
              node_name: node,
              public_key: res.public_key,
            });
          });
        },
        cbk);
      }],

      // Filter out nodes not on the specified network
      filter: ['getNodes', ({getNodes}, cbk) => {
        // Exit early when no network is specified
        if (!network) {
          return cbk(null, getNodes);
        }

        const nodes = getNodes.filter(n => !!n.is_online);

        return asyncFilter(nodes, ({lnd}, cbk) => {
          return getNetwork({lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, res.network === network);
          });
        },
        cbk);
      }],

      // Final list of nodes
      nodes: ['filter', ({filter}, cbk) => cbk(null, {nodes: filter})],
    },
    returnResult({reject, resolve, of: 'nodes'}, cbk));
  });
};
