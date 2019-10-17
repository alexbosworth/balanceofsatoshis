const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const decryptSavedMacaroons = require('./decrypt_saved_macaroons');
const encryptSavedMacaroons = require('./encrypt_saved_macaroons');
const getSavedCredentials = require('./get_saved_credentials');
const getSavedNodes = require('./get_saved_nodes');

const {isArray} = Array;

/** Adjust or view the set of saved nodes

  {
    fs: {
      getDirectoryFiles: <Read Directory Contents Function> (path, cbk) => {}
      getFile: <Read File Contents Function> (path, cbk) => {}
      getFileStatus: <File Status Function> (path, cbk) => {}
      writeFile: <Write File Contents Function> (path, contents, cbk) => {}
    }
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
        if (!args.fs) {
          return cbk([400, 'ExpectedFilesystemMethodsToAdjustSavedNodes']);
        }

        if (!isArray(args.lock_credentials_to)) {
          return cbk([400, 'ExpectedArrayOfLockingCredentialGpgIds']);
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

      // Check specified node exists
      checkNode: ['validate', ({}, cbk) => {
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

      // Get existing set of nodes
      getNodes: ['checkNode', ({}, cbk) => getSavedNodes({fs: args.fs}, cbk)],

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
