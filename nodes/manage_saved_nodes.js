const {homedir} = require('os');
const {join} = require('path');

const asyncAuto = require('async/auto');
const {generateKeyPair} = require('crypto');
const {privateDecrypt} = require('crypto');
const {returnResult} = require('asyncjs-util');

const decryptSavedMacaroons = require('./decrypt_saved_macaroons');
const deleteNodeCredentials = require('./delete_node_credentials');
const encryptSavedMacaroons = require('./encrypt_saved_macaroons');
const getSavedCredentials = require('./get_saved_credentials');
const getSavedNodes = require('./get_saved_nodes');
const {home} = require('../storage');
const registerNode = require('./register_node');

const {isArray} = Array;

/** Adjust or view the set of saved nodes

  {
    ask: <Inquirer Function> ({message, name, type}, cbk) => {}
    fs: {
      getDirectoryFiles: <Read Directory Contents Function> (path, cbk) => {}
      getFile: <Read File Contents Function> (path, cbk) => {}
      getFileStatus: <File Status Function> (path, cbk) => {}
      makeDirectory: <Make Directory Function> (path, cbk) => {}
      removeDirectory: <Remove Directory Function> (path, cbk) => {}
      removeFile: <Remove File Function> (path, cbk) => {}
      writeFile: <Write File Contents Function> (path, contents, cbk) => {}
    }
    [is_including_lnd_api]: <Include Node LND API Object Bool>
    [is_registering]: <Add Node Credentials Bool>
    [is_removing]: <Remove Node Credentials Bool>
    [is_unlocking]: <Change Credentials To Decrypted Copy Bool>
    lock_credentials_to: [<Encrypt Macaroon to GPG Key With Id String>]
    logger: <Winston Logger Object>
    [network]: <Return Nodes On Specified Network String>
    [node]: <Node Name String>
    spawn: <Spawn Function>
  }

  @returns via cbk or Promise
  {
    nodes: [{
      [is_online]: <Node is Online Bool>
      [lnd]: <Authenticated LND API Object>
      node_name: <Node Name String>
      public_key: <Node Identity Public Key Hex String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskMethodToAdjustSavedNodes']);
        }

        if (!args.fs) {
          return cbk([400, 'ExpectedFilesystemMethodsToAdjustSavedNodes']);
        }

        if (!isArray(args.lock_credentials_to)) {
          return cbk([400, 'ExpectedArrayOfLockingCredentialGpgIds']);
        }

        if (!!args.is_registering && !!args.is_removing) {
          return cbk([400, 'CannotAddAndRemoveNodesAtTheSameTime']);
        }

        if (!!args.is_removing && !args.node) {
          return cbk([400, 'SpecifyingNodeNameIsRequiredToRemoveNode']);
        }

        if (!!args.is_unlocking && args.is_unlocking !== true) {
          return cbk([400, 'UnexpectedArgumentForUnlocking']);
        }

        if (!!args.is_unlocking && !!args.lock_credentials_to.length) {
          return cbk([400, 'CannotBothUnlockAndLockNodeCredentials']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerFunctionForSavedNodes']);
        }

        if (!args.spawn) {
          return cbk([400, 'ExpectedSpawnFunctionToAdjustSavedNodes']);
        }

        return cbk();
      },

      // Make sure the home directory is there
      registerHomeDir: ['validate', ({}, cbk) => {
        return args.fs.makeDirectory(join(...[homedir(), home()]), err => {
          // Ignore errors, the directory may already be there
          return cbk();
        });
      }],

      // Register node
      register: ['registerHomeDir', ({}, cbk) => {
        if (!args.is_registering) {
          return cbk();
        }

        return registerNode({
          ask: args.ask,
          cryptography: {generateKeyPair, privateDecrypt},
          fs: args.fs,
          logger: args.logger,
          node: args.node,
        },
        cbk);
      }],

      // Check specified node exists
      checkNode: ['register', ({}, cbk) => {
        if (!args.node) {
          return cbk();
        }

        return getSavedCredentials({
          fs: args.fs,
          node: args.node,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          if (!res.credentials) {
            return cbk([404, 'SpecifiedNodeNotFound']);
          }

          return cbk();
        });
      }],

      // Remove node if requested
      remove: ['checkNode', ({}, cbk) => {
        // Exit early when not removing a node
        if (!args.is_removing) {
          return cbk();
        }

        return deleteNodeCredentials({fs: args.fs, node: args.node}, cbk);
      }],

      // Get existing set of nodes
      getNodes: ['remove', ({}, cbk) => {
        return getSavedNodes({fs: args.fs, network: args.network}, cbk);
      }],

      // Encrypt macaroons
      lock: ['getNodes', ({getNodes}, cbk) => {
        // Exit early when not locking credentials
        if (!args.lock_credentials_to.length) {
          return cbk();
        }

        const {nodes} = getNodes;

        return encryptSavedMacaroons({
          fs: args.fs,
          logger: args.logger,
          nodes: !args.node ? nodes.map(n => n.node_name) : [args.node],
          spawn: args.spawn,
          to: args.lock_credentials_to,
        },
        cbk);
      }],

      // Unlock credentials
      unlock: ['getNodes', ({getNodes}, cbk) => {
        // Exit early when not unlocking credentials
        if (!args.is_unlocking) {
          return cbk();
        }

        const {nodes} = getNodes;

        return decryptSavedMacaroons({
          fs: args.fs,
          logger: args.logger,
          nodes: !args.node ? nodes.map(n => n.node_name) : [args.node],
          spawn: args.spawn,
        },
        cbk);
      }],

      // Get saved nodes
      getSaved: ['getNodes', 'lock', 'unlock', ({getNodes}, cbk) => {
        if (!args.is_registering && !args.is_removing && !args.is_unlocking) {
          return cbk(null, getNodes);
        }

        return getSavedNodes({fs: args.fs, network: args.network}, cbk);
      }],

      // Final set of saved nodes
      nodes: ['getSaved', ({getSaved}, cbk) => {
        const nodes = getSaved.nodes.map(node => ({
          is_online: node.is_online,
          lnd: !!args.is_including_lnd_api ? node.lnd : undefined,
          node_name: node.node_name,
          public_key: node.public_key,
        }));

        return cbk(null, {nodes});
      }],
    },
    returnResult({reject, resolve, of: 'nodes'}, cbk));
  });
};
