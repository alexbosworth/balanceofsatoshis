const {join} = require('path');
const {homedir} = require('os');

const asyncAuto = require('async/auto');
const asyncFilter = require('async/filter');
const asyncMap = require('async/map');
const {authenticatedLndGrpc} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const getSavedCredentials = require('./get_saved_credentials');
const {home} = require('./constants');

/** Get a list of saved nodes

  {
    fs: {
      getDirectoryFiles: <Read Directory Contents Function> (path, cbk) => {}
      getFile: <Read File Contents Function> (path, cbk) => {}
      getFileStatus: <File Status Function> (path, cbk) => {}
    }
  }

  @returns via cbk or Promise
  {
    nodes: [{
      [is_online]: <Node is Online Bool>
      node_name: <Node Name String>
    }]
  }
*/
module.exports = ({fs}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Data directory
      dataDir: cbk => cbk(null, join(...[homedir(), home])),

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
            const path = join(...[homedir(), home, file]);

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
              node_name: node,
              is_online: res.is_synced_to_chain,
            });
          });
        },
        cbk);
      }],

      // Final list of nodes
      nodes: ['getNodes', ({getNodes}, cbk) => cbk(null, {nodes: getNodes})],
    },
    returnResult({reject, resolve, of: 'nodes'}, cbk));
  });
};
