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
const nostrKeyFilePath = () => homePath({file: 'nostr_private_key'}).path;
const {parse} = JSON;
const relayFilePath = () => homePath({file: 'nostr_relays.json'}).path;
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

      // Get nostr private key from file
      getNostrKey: ['validate', ({}, cbk)  => {
        return args.fs.getFile(nostrKeyFilePath(), (err, res) => {
          if (!!err || !res) {
            return cbk([400, 'FailedToReadNostrKeyFileToBuildEvent']);
          }

            return cbk(null, res.toString());
        });
      }],

      // Get relays from file
      getRelays: ['validate', ({}, cbk) => {
        return args.fs.getFile(relayFilePath(), (err, res) => {
          if (!!err || !res) {
            return cbk([400, 'FailedToReadRelaysJsonFileToBuildEvent']);
          }

          try {
            const result = parse(res);

            if (!result.relays || !result.relays.length) {
              return cbk([400, 'ExpectedAtleastOneRelayToBuildEvent']);
            }
          } catch (err) {
            return cbk([400, 'FailedToParseRelaysJsonFileToBuildEvent']);
          }

            return cbk(null, {relays: parse(res).relays});
        });
      }],

      // Decrypt nostr private key
      decrypt: ['getNostrKey', ({getNostrKey}, cbk) => {
        return decryptWithNode({
          encrypted: getNostrKey,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Build the nostr event
      buildEvent: [
        'decrypt', 
        'ecp', 
        'getRelays', ({decrypt, ecp}, cbk) => {
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
      publish: ['buildEvent', 'getRelays', ({buildEvent, getRelays}, cbk) => {
        return publishToRelays({
          event: stringify(['EVENT', buildEvent.event]),
          logger: args.logger,
          relays: getRelays.relays}, cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
