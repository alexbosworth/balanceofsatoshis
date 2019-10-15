const {join} = require('path');
const {homedir} = require('os');

const asyncAuto = require('async/auto');
const asyncFilter = require('async/filter');
const asyncMap = require('async/map');
const {authenticatedLndGrpc} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const credentials = 'credentials.json';
const home = '.bos';
const {parse} = JSON;

/** Get a list of saved nodes

  {
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
      getFileStatus: <File Status Function> (path, cbk) => {}
      getDirectoryFiles: <Read Directory Contents Function> (path, cbk) => {}
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

        if (!fs.getFile) {
          return cbk([400, 'ExpectedReadFileFunction']);
        }

        if (!fs.getFileStatus) {
          return cbk([400, 'ExpectedReadFileStatusFunction']);
        }

        if (!fs.getDirectoryFiles) {
          return cbk([400, 'ExpectedGetDirectoryFilesMethod']);
        }

        return cbk();
      },

      // Check that the data directory exists
      checkDataDir: ['dataDir', ({dataDir}, cbk) => {
        return fs.getFileStatus(dataDir, (err, res) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorCheckingForDataDirectory', {err}]);
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
        const credentialPaths = getDirs.map(dir => {
          return {dir, path: join(...[homedir(), home, dir, credentials])};
        });

        return asyncMap(credentialPaths, ({dir, path}, cbk) => {
          return fs.getFile(path, (err, res) => {
            if (!!err || !res) {
              return cbk();
            }

            try {
              parse(res.toString());
            } catch (err) {
              return cbk([400, 'SavedNodeHasInvalidCredentials', {err, path}]);
            }

            const credentials = parse(res.toString());

            if (!credentials.cert) {
              return cbk([400, 'SavedNodeMissingCertData', {dir}]);
            }

            if (!credentials.macaroon) {
              return cbk([400, 'SavedNodeMissingCertData', {dir}]);
            }

            if (!credentials.socket) {
              return cbk([400, 'SavedNodeMissingSocket', {dir}]);
            }

            return cbk(null, {credentials, dir});
          });
        },
        cbk);
      }],

      // Get node info
      getNodes: ['getNodeCredentials', ({getNodeCredentials}, cbk) => {
        return asyncMap(getNodeCredentials, ({credentials, dir}, cbk) => {
          const {lnd} = authenticatedLndGrpc(credentials);

          return getWalletInfo({lnd}, (err, res) => {
            if (!!err) {
              return cbk(null, {node_name: dir});
            }

            return cbk(null, {
              node_name: dir,
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
