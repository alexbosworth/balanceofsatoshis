const asyncAuto = require('async/auto');
const asyncEachSeries = require('async/eachSeries');
const asyncEach = require('async/each');
const {returnResult} = require('asyncjs-util');
const {createHash} = require('crypto');

const tinysecp256k1 = require('tiny-secp256k1');
const util = require('util');
const WebSocket = require('ws');

const {homePath} = require('../storage');
const {decryptWithNode} = require('../encryption');

const bufferAsString = buffer => buffer.toString();
const createdAt = () => Math.round(Date.now() / 1000);
const encoder = new util.TextEncoder('utf-8');
const eventKind = 1;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const nostrKeyFilePath = () => homePath({file: 'nostr_private_key'}).path;
const {parse} = JSON;
const recommendedRelayUrl = "wss://nostr.foundrydigital.com"
const relayFilePath = () => homePath({file: 'nostr_relays.json'}).path;
const sha256 = n => createHash('sha256').update(n).digest();
const stringAsUtf8 = n => Buffer.from(n, 'utf-8');
const unit8AsHex = n => Buffer.from(n).toString('hex');



module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Import the ECPair library
      ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp256k1),
      
      // Check arguments
      validate: cbk => {
        if (!args.fs) {
          return cbk([400, 'ExpectedFilesystemMethodsToBroadcastMessage']);
        }

        if (!args.group_open_event) {
          return cbk([400, 'ExpectedGroupOpenEventToBroadcastMessage']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToBroadcastMessage']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToBroadcastMessage']);
        }

        return cbk();
      },

      // Get nostr private key from file
      getNostrKey: ['validate', ({}, cbk)  => {
        return args.fs.getFile(nostrKeyFilePath(), (err, res) => {
          if (!!err || !res) {
            return cbk([400, 'FailedToReadNostrKeyFileToBroadcastMessage']);
          }

            return cbk(null, res.toString());
        });
      }],

      // Get relays from file
      getRelays: ['validate', ({}, cbk) => {
        return args.fs.getFile(relayFilePath(), (err, res) => {
          if (!!err || !res) {
            return cbk([400, 'FailedToReadRelaysJsonFileToBroadcastMessage']);
          }

          try {
            const result = parse(res);

            if (!result.relays || !result.relays.length) {
              return cbk([400, 'ExpectedAtleastOneRelayToBroadcastMessage']);
            }
          } catch (err) {
            return cbk([400, 'FailedToParseRelaysJsonFileToBroadcastMessage']);
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

      buildEvent: [
        'decrypt', 
        'ecp', 
        'getRelays', ({decrypt, ecp}, cbk) => {
        try {          
          const key = ecp.fromPrivateKey(hexAsBuffer(decrypt.message));
          const publicKey = unit8AsHex(key.publicKey.slice(1));
          const created = createdAt();
          const content = `This is a test from BalanceOfSatoshis: \n Group Open Invite Code: ${args.group_open_event}`;

          const commit = JSON.stringify([0, publicKey, created, eventKind, [], content]);
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

      publish: ['buildEvent', 'getRelays', ({buildEvent, getRelays}, cbk) => {
        return asyncEach(getRelays.relays, (relay, cbk) => {
          const ws = new WebSocket(relay);

          ws.on('error', err => {
            args.logger.info({relay, error: err});
            ws.close();
            return cbk();
          });
  
          ws.on('open', () => {
            ws.send(JSON.stringify(['EVENT', buildEvent.event]));
          });
  
          ws.on('message', function message(data) {
            args.logger.info({relay, is_ok: bufferAsString(data)});
            ws.close();
            return cbk();
          });
        },
        cbk);
      }]

    },
    returnResult({reject, resolve}, cbk));
  });
};
