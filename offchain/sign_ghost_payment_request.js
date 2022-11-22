const asyncAuto = require('async/auto');
const {createSignedRequest} = require('ln-service');
const {createUnsignedRequest} = require('ln-service');
const {randomBytes} = require('crypto');
const {returnResult} = require('asyncjs-util');
const secp256k1 = require('secp256k1');
const {subscribeToForwardRequests} = require('ln-service');
const tinysecp256k1 = require('tiny-secp256k1');

const defaultBaseFee = '0';
const defaultCltvDelta = 18;
const defaultFeeRate = 0;
const fakeChannelId = '150x1x0';
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isArray} = Array;
const unit8AsHex = n => Buffer.from(n).toString('hex');

/** Sign a BOLT 11 Ghost Payment Request and Intercept

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
    features: [{
      bit: <Feature Bit Number>
      is_known: <Is Known Feature Bool>
      is_required: <Is Required Feature Bool>
      type: <Feature Type String>
    }]
    id: <Payment Hash Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
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
          return cbk([400, 'ExpectedArrayOfChannelsToSignGhostPaymentRequest']);
        }

        if (!args.cltv_delta) {
          return cbk([400, 'ExpectedFinalCltvDeltaToSignGhostPaymentRequest']);
        }

        if (args.description === undefined) {
          return cbk([400, 'ExpectedInvoiceDescriptionToSignGhostPaymentRequest']);
        }

        if (!args.destination) {
          return cbk([400, 'ExpectedDestinationNodeIdToSignGhostPaymentRequest']);
        }

        if (!isArray(args.features) || !args.features.length) {
          return cbk([400, 'ExpectedFeaturesBitsToSignGhostPaymentRequest'])
        }

        if (!args.id) {
          return cbk([400, 'ExpectedPaymentHashToSignGhostPaymentRequest']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToSignGhostPaymentRequest']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerObjectToSignGhostPaymentRequest']);
        }

        if (!args.network) {
          return cbk([400, 'ExpectedNetworkNameToSignGhostPaymentRequest']);
        }

        if (!args.payment) {
          return cbk([400, 'ExpectedPaymentNonceToSignGhostPaymentRequest']);
        }

        if (!args.secret) {
          return cbk([400, 'ExpectedPaymentSecretToSignGhostPaymentRequest']);
        }

        if (args.tokens === undefined) {
          return cbk([400, 'ExpectedTokensToInvoiceToSignGhostPaymentRequest']);
        }

        return cbk();
      },

      // Create a fake key pair
      getKeyPair: [
        'validate',
        ({}, cbk) => {
          const privateKey = randomBytes(32);
          const publicKey = secp256k1.publicKeyCreate(privateKey);

          return cbk(null, {private_key: privateKey, public_key: unit8AsHex(publicKey)});
        }
      ],

      // Assemble the hop hints from the chosen hint channels
      hints: ['getKeyPair', 'validate', ({getKeyPair}, cbk) => {
          const routes =  [
            {
              public_key: args.destination
            },
            {
              base_fee_mtokens: defaultBaseFee,
              channel: fakeChannelId,
              cltv_delta: defaultCltvDelta,
              fee_rate: defaultFeeRate,
              public_key: getKeyPair.public_key,
            },
          ];

        return cbk(null, [routes]);
      }],

      // Create the unsigned payment request
      unsigned: ['hints', 'getKeyPair', ({getKeyPair, hints}, cbk) => {
        try {
          const unsigned = createUnsignedRequest({
            cltv_delta: args.cltv_delta,
            description: args.description,
            destination: getKeyPair.public_key,
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
        const signature = tinysecp256k1.sign(hexAsBuffer(unsigned.hash), getKeyPair.private_key);

        return cbk(null, {signature: unit8AsHex(signature)});
      }],

      // Assemble the signed request
      request: [
        'getKeyPair', 
        'sign', 
        'unsigned', 
        ({getKeyPair, sign, unsigned}, cbk) => {
        try {
          const {request} = createSignedRequest({
            destination: getKeyPair.public_key,
            hrp: unsigned.hrp,
            signature: sign.signature,
            tags: unsigned.tags,
          });

          args.logger.info({
            request,
            tokens: args.tokens
          });
          
          return cbk(null, {request, tokens: args.tokens});
        } catch (err) {
          return cbk([503, 'UnexpectedErrorSigningRequest', {err}]);
        }
      }],

      // Subscribe and intercept forward request
      intercept: [
        'request',
        'unsigned',
        ({}, cbk) => {
          args.logger.info({
            is_intercepting_forward: true,
          });

          const sub = subscribeToForwardRequests({lnd: args.lnd});

          const finished = (err, res) => {
            sub.removeAllListeners();

            return cbk(err, res);
          };
          
          sub.on('forward_request', forward => {
            if (args.id === forward.hash) {
              forward.settle({secret: args.secret})
              
            } else {
              forward.accept({})
            }
          });

          sub.on('error', err => {
            console.log(err)
            finished(err);
          });
        }
      ]
    },
    returnResult({reject, resolve, of: 'request'}, cbk));
  });
};
