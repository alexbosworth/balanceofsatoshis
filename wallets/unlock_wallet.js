const {readFile} = require('fs');

const asyncAuto = require('async/auto');
const {authenticatedLndGrpc} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {signMessage} = require('ln-service');
const {unauthenticatedLndGrpc} = require('ln-service');
const {unlockWallet} = require('ln-service');

const {lndCredentials} = require('./../lnd');

const message = 'message';

/** Unlock wallet if locked

  {
    [node]: <Node Name String>
    path_to_password_file: <Path to Password File String>
  }

  @returns via cbk
  {
    is_already_unlocked: <Is Already Unlocked Bool>
  }
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Credentials
    credentials: cbk => lndCredentials({node: args.node}, cbk),

    // Lnd
    lnd: ['credentials', ({credentials}, cbk) => {
      return cbk(null, authenticatedLndGrpc({
        cert: credentials.cert,
        macaroon: credentials.macaroon,
        socket: credentials.socket,
      }).lnd);
    }],

    // Check if locked
    checkLocked: ['lnd', ({lnd}, cbk) => {
      return signMessage({lnd, message}, (err, res) => {
        if (!!res && !!res.signature) {
          return cbk(null, {is_already_unlocked: true});
        }

        return cbk(null, {is_already_unlocked: false});
      });
    }],

    // Get password
    password: ['checkLocked', ({checkLocked}, cbk) => {
      if (!!checkLocked.is_already_unlocked) {
        return cbk();
      }

      if (!args.path_to_password_file) {
        return cbk([400, 'ExpectedPathToPasswordFile']);
      }

      return readFile(args.path_to_password_file, (err, password) => {
        if (!!err) {
          return cbk([400, 'FailedToReadPasswordFile', err]);
        }

        return cbk(null, password.toString().trim());
      });
    }],

    // Unlock
    unlock: ['credentials', 'password', ({credentials, password}, cbk) => {
      if (!password) {
        return cbk();
      }

      const {lnd} = unauthenticatedLndGrpc({
        cert: credentials.cert,
        socket: credentials.socket,
      });

      return unlockWallet({lnd, password}, cbk);
    }],

    // Unlocked status
    unlocked: ['checkLocked', 'unlock', ({checkLocked}, cbk) => {
      return cbk(null, {
        is_already_unlocked: checkLocked.is_already_unlocked,
      });
    }],
  },
  returnResult({of: 'unlocked'}, cbk));
};
