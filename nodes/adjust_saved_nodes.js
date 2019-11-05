const asyncAuto = require('async/auto');
const {generateKeyPair} = require('crypto');
const {privateDecrypt} = require('crypto');
const {returnResult} = require('asyncjs-util');

const decryptSavedMacaroons = require('./decrypt_saved_macaroons');
const deleteNodeCredentials = require('./delete_node_credentials');
const encryptSavedMacaroons = require('./encrypt_saved_macaroons');
const getSavedCredentials = require('./get_saved_credentials');
const getSavedNodes = require('./get_saved_nodes');
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
    [is_registering]: <Add Node Credentials Bool>
    [is_removing]: <Remove Node Credentials Bool>
    [is_unlocking]: <Change Credentials To Decrypted Copy Bool>
    lock_credentials_to: [<Encrypt Macaroon to GPG Key With Id String>]
    logger: <Winston Logger Object>
    [node]: <Node Name String>
  }

  @returns via cbk or Promise
  {
    nodes: [{
      [is_online]: <Node is Online Bool>
      [encrypted_to]: [<Encrypted To GPG Id String>]
      node_name: <Node Name String>
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

        return cbk();
      },

      // Register node
      register: ['validate', ({}, cbk) => {
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
      getNodes: ['remove', ({}, cbk) => getSavedNodes({fs: args.fs}, cbk)],

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
        },
        cbk);
      }],

      // Get saved nodes
      getSaved: ['lock', 'unlock', ({}, cbk) => {
        return getSavedNodes({fs: args.fs}, cbk);
      }],
    },
    returnResult({reject, resolve, of: 'getSaved'}, cbk));
  });
};
