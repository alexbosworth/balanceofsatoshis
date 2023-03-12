const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {createHash} = require('crypto');

const tinysecp256k1 = require('tiny-secp256k1');

const {decryptWithNode} = require('../encryption');
const {homePath} = require('../storage');
const publishToRelays = require('./publish_to_relays');

const createdAt = () => Math.round(Date.now() / 1000);
const eventKind = 1;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isArray} = Array;
const nostrFilePath = () => homePath({file: 'nostr.json'}).path;
const {parse} = JSON;
const sha256 = n => createHash('sha256').update(n).digest();
const stringAsUtf8 = n => Buffer.from(n, 'utf-8');
const {stringify} = JSON;
const unit8AsHex = n => Buffer.from(n).toString('hex');

/** Build nostr event to publish

  {
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    message: <Message For Event String>
    node: <Saved Node Name String>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Import the ECPair library
      ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp256k1),
      
      // Check arguments
      validate: cbk => {
        if (!args.fs) {
          return cbk([400, 'ExpectedFilesystemMethodsToBuildEvent']);
        }

        if (!args.message) {
          return cbk([400, 'ExpectedMessageEventToBuildEvent']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToBuildEvent']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToBuildEvent']);
        }

        return cbk();
      },

      // Get relays and nostr key
      readFile: ['validate', ({}, cbk) => {
        const node = args.node || '';

        return args.fs.getFile(nostrFilePath(), (err, res) => {
          if (!!err || !res) {
            return cbk([400, 'FailedToReadRelaysJsonFileToBuildEvent']);
          }

          try {
            const result = parse(res.toString());

            if (!result.nostr || !isArray(result.nostr) || !result.nostr.length) {
              return cbk([400, 'ExpectedNostrKeyAndRelaysToBuildEvent']);
            }

            const findNode = result.nostr.find(n => n.node === node);

            if (!findNode) {
              return cbk([400, 'ExpectedNostrKeyAndRelaysForSavedNode']);
            }

            if (!findNode.key) {
              return cbk([400, 'ExpectedNostrKeyToBuildEvent']);
            }

            if (!findNode.relays.length) {
              return cbk([400, 'ExpectedAtLeastOneRelayToBuildEvent']);
            }

            return cbk(null, {key: findNode.key, relays: findNode.relays})
          } catch (err) {
            return cbk([400, 'FailedToParseRelaysJsonFileToBuildEvent']);
          }
        });
      }],

      // Decrypt nostr private key
      decrypt: ['readFile', ({readFile}, cbk) => {
        return decryptWithNode({
          encrypted: readFile.key,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Build the nostr event
      buildEvent: [
        'decrypt', 
        'ecp', 
        'readFile', ({decrypt, ecp}, cbk) => {
        try {          
          const key = ecp.fromPrivateKey(hexAsBuffer(decrypt.message));
          const publicKey = unit8AsHex(key.publicKey.slice(1));
          const created = createdAt();
          const content = `This is a test from BalanceOfSatoshis: \n Group Open Invite Code: ${args.message}`;

          const commit = stringify([0, publicKey, created, eventKind, [], content]);
          const buf = stringAsUtf8(commit);
          const hash = sha256(buf);

          const eventId = unit8AsHex(hash);

          const signature = unit8AsHex(tinysecp256k1.signSchnorr(hash, hexAsBuffer(decrypt.message)));

          const event = {
            content,
            id: eventId,
            pubkey: publicKey,
            created_at: created,
            kind: eventKind,
            tags: [],
            sig: signature,
          }

          return cbk(null, {event});
        } catch (err) {
          return cbk([400, 'UnexpectedErrorBuildingEvent', {err}]);
        }
      }],

      // Publish event to relays
      publish: ['buildEvent', 'readFile', ({buildEvent, readFile}, cbk) => {
        return publishToRelays({
          event: stringify(['EVENT', buildEvent.event]),
          logger: args.logger,
          relays: readFile.relays
        }, cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
