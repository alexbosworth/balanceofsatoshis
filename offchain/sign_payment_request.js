const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const {createSignedRequest} = require('ln-service');
const {createUnsignedRequest} = require('ln-service');
const {decode} = require('bip66');
const {returnResult} = require('asyncjs-util');
const {signBytes} = require('ln-service');
const tinysecp256k1 = require('tiny-secp256k1');

const bufferAsHex = buffer => buffer.toString('hex');
const {concat} = Buffer;
const defaultBaseFee = '1000';
const defaultCltvDelta = 144;
const defaultFeeRate = '1';
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isArray} = Array;
const keyFamilyIdentity = 6;
const keyIndexIdentity = 0;
const makePrivateKey = () => randomBytes(32);
const minimalCltvDelta = 18;
const rValue = r => r.length === 33 ? r.slice(1) : r;
const unit8AsHex = n => Buffer.from(n).toString('hex');
const virtualChannelId = '805x805x805';

/** Create a signed BOLT 11 payment request

  {
    channels: [{
      id: <Channel Id String>
      policies: [{
        [base_fee_mtokens]: <Base Routing Fee Millitokens String>
        [cltv_delta]: <Routing CLTV Delta Number>
        [fee_rate]: <Routing PPM Fee Rate Number>
        public_key: <Node Identity Public Key Hex String>
      }]
    }]
    cltv_delta: <Invoice Final CLTV Delta Number>
    description: <Invoice Description String>
    destination: <Destination Public Key Hex String>
    [expires_at]: <Invoice Expires At String>
    features: [{
      bit: <BOLT 09 Feature Bit Number>
    }]
    id: <Payment Hash Hex String>
    lnd: <Authenticated LND API Object>
    network: <BitcoinJs Network Name String>
    payment: <Payment Nonce Hex String>
    tokens: <Invoiced Amount Tokens Number>
  }

  @returns via cbk or Promise
  {
    request: <BOLT 11 Payment Request String>
    tokens: <Invoiced Tokens Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.channels)) {
          return cbk([400, 'ExpectedArrayOfChannelsToSignPaymentRequest']);
        }

        if (!args.cltv_delta) {
          return cbk([400, 'ExpectedFinalCltvDeltaToSignPaymentRequest']);
        }

        if (args.description === undefined) {
          return cbk([400, 'ExpectedInvoiceDescriptionToSignPaymentRequest']);
        }

        if (!args.destination) {
          return cbk([400, 'ExpectedDestinationNodeIdToSignPaymentRequest']);
        }

        if (!isArray(args.features)) {
          return cbk([400, 'ExpectedFeatureBitsToSignPaymentRequest']);
        }

        if (!args.id) {
          return cbk([400, 'ExpectedPaymentHashToSignPaymentRequest']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToSignPaymentRequest']);
        }

        if (!args.network) {
          return cbk([400, 'ExpectedNetworkNameToSignPaymentRequest']);
        }

        if (!args.payment) {
          return cbk([400, 'ExpectedPaymentNonceToSignPaymentRequest']);
        }

        if (args.tokens === undefined) {
          return cbk([400, 'ExpectedTokensToInvoiceToSignPaymentRequest']);
        }

        return cbk();
      },

      // Create a key pair for a virtual channel invoice
      getKeyPair: ['validate', async ({}, cbk) => {
        // Exit early when not using a virtual channel
        if (!args.is_virtual) {
          return;
        }

        const ecp = (await import('ecpair')).ECPairFactory(tinysecp256k1);

        const key = ecp.fromPrivateKey(makePrivateKey());

        const publicKey = unit8AsHex(key.publicKey);

        return {private_key: key.privateKey, public_key: publicKey};
      }],

      // Assemble the hop hints from the chosen hint channels
      hints: ['getKeyPair', ({getKeyPair}, cbk) => {
        // Exit early when using a virtual channel
        if (!!args.is_virtual) {
          return cbk(null, [[
            {
              public_key: args.destination,
            },
            {
              base_fee_mtokens: Number().toString(),
              channel: virtualChannelId,
              cltv_delta: minimalCltvDelta,
              fee_rate: args.virtual_fee_rate || Number(),
              public_key: getKeyPair.public_key,
            },
          ]]);
        }

        const routes = args.channels.map(({id, policies}) => {
          const peerPolicy = policies.find(policy => {
            return policy.public_key !== args.destination;
          });

          return [
            {
              public_key: peerPolicy.public_key,
            },
            {
              base_fee_mtokens: peerPolicy.base_fee_mtokens || defaultBaseFee,
              channel: id,
              cltv_delta: peerPolicy.cltv_delta || defaultCltvDelta,
              fee_rate: peerPolicy.fee_rate || defaultFeeRate,
              public_key: args.destination,
            },
          ];
        });

        return cbk(null, routes);
      }],

      // Create the unsigned payment request
      unsigned: ['hints', ({hints}, cbk) => {
        const [destination] = hints.slice().reverse();

        try {
          const unsigned = createUnsignedRequest({
            cltv_delta: args.cltv_delta,
            description: args.description,
            destination: destination.public_key,
            expires_at: args.expires_at,
            features: args.features,
            id: args.id,
            network: args.network,
            payment: args.payment,
            routes: !!hints.length ? hints : undefined,
            tokens: args.tokens,
          });

          return cbk(null, unsigned);
        } catch (err) {
          return cbk([500, 'UnexpectedErrorCreatingUnsignedRequest', {err}]);
        }
      }],

      // Sign the unsigned payment request
      sign: ['getKeyPair', 'unsigned', ({getKeyPair, unsigned}, cbk) => {
        // Exit early when signing using the virtual key
        if (!!args.is_virtual) {
          const signature = tinysecp256k1.sign(
            hexAsBuffer(unsigned.hash),
            getKeyPair.private_key
          );

          return cbk(null, {
            destination: getKeyPair.public_key,
            signature: unit8AsHex(signature),
          });
        }

        // Sign the modified payment request using the identity public key
        return signBytes({
          key_family: keyFamilyIdentity,
          key_index: keyIndexIdentity,
          lnd: args.lnd,
          preimage: unsigned.preimage,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          // Convert the signature format
          const {r, s} = decode(hexAsBuffer(res.signature));

          return cbk(null, {
            destination: args.destination,
            signature: bufferAsHex(concat([rValue(r), s])),
          });
        });
      }],

      // Assemble the full signed request
      request: ['sign', 'unsigned', ({sign, unsigned}, cbk) => {
        try {
          const {request} = createSignedRequest({
            destination: sign.destination,
            hrp: unsigned.hrp,
            signature: sign.signature,
            tags: unsigned.tags,
          });

          return cbk(null, {request, tokens: args.tokens});
        } catch (err) {
          return cbk([503, 'UnexpectedErrorSigningRequest', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'request'}, cbk));
  });
};
