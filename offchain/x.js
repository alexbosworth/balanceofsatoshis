const {createHash} = require('crypto');

const {crypto} = require('bitcoinjs-lib');
const {featureFlagsAsWords} = require('bolt09');

const chainAddressAsWords = require('./chain_address_as_words');
const currencyCodes = require('./conf/bech32_currency_codes');
const descriptionAsWords = require('./description_as_words');
const hexAsWords = require('./hex_as_words');
const hopAsHex = require('./hop_as_hex');
const mtokensAsHrp = require('./mtokens_as_hrp');
const numberAsWords = require('./number_as_words');
const taggedFields = require('./conf/tagged_fields');
const wordsAsBuffer = require('./words_as_buffer');

const decBase = 10;
const defaultExpireMs = 1e3 * 60 * 60 * 24;
const flatten = arr => [].concat(...arr);
const {floor} = Math;
const {keys} = Object;
const maxDescriptionLen = 639;
const msPerSec = 1e3;
const mtokPerTok = 1e3;
const {now} = Date;
const {parse} = Date;
const {sha256} = crypto;
const tokensAsMtokens = n => !n ? '0' : (BigInt(n) * BigInt(1e3)).toString();

/** Create an unsigned payment request
  {
    [chain_addresses]: [<Chain Address String>]
    [cltv_delta]: <CLTV Delta Number>
    [created_at]: <Invoice Creation Date ISO 8601 String>
    [description]: <Description String>
    [description_hash]: <Description Hash Hex String>
    destination: <Public Key String>
    [expires_at]: <ISO 8601 Date String>
    features: [{
      bit: <BOLT 09 Feature Bit Number>
    }]
    id: <Preimage SHA256 Hash Hex String>
    [mtokens]: <Requested Milli-Tokens Value String> (can exceed Number limit)
    network: <Network Name String>
    [payment]: <Payment Identifier Hex String>
    [routes]: [[{
      [base_fee_mtokens]: <Base Fee Millitokens String>
      [channel]: <Standard Format Channel Id String>
      [cltv_delta]: <Final CLTV Expiration Blocks Delta Number>
      [fee_rate]: <Fee Rate Millitokens Per Million Number>
      public_key: <Forward Edge Public Key Hex String>
    }]]
    [tokens]: <Requested Chain Tokens Number> (note: can differ from mtokens)
  }
  @returns
  {
    hash: <Payment Request Signature Hash Hex String>
    hrp: <Human Readable Part of Payment Request String>
    preimage: <Signature Hash Preimage Hex String>
    tags: [<Data Tag Number>]
  }
*/
module.exports = args => {
  if (args.description === undefined && !args.description_hash) {
    throw new Error('ExpectedPaymentDescriptionOrDescriptionHashForPayReq');
  }

  if (Buffer.byteLength(args.description || '', 'utf8') > maxDescriptionLen) {
    throw new Error('ExpectedPaymentDescriptionWithinDescriptionByteLimit');
  }

  if (!args.id) {
    throw new Error('ExpectedPaymentHashWhenEncodingPaymentRequest');
  }

  const createdAt = floor((parse(args.created_at) || now()) / msPerSec);

  const defaultExpiresAt = new Date(createdAt + defaultExpireMs).toISOString();

  const expiresAt = args.expires_at || defaultExpiresAt;

  const expiresAtEpochTime = floor(parse(expiresAt) / msPerSec);

  const currencyPrefix = keys(currencyCodes)
    .map(code => ({code, network: currencyCodes[code]}))
    .find(({network}) => network === args.network);

  if (!currencyPrefix) {
    throw new Error('ExpectedKnownNetworkToEncodePaymentRequest');
  }

  const createdAtWords = numberAsWords({number: floor(createdAt)}).words;
  const mtokens = args.mtokens || tokensAsMtokens(args.tokens);

  const hrp = `ln${currencyPrefix.code}${mtokensAsHrp({mtokens}).hrp}`;

  const fieldWords = flatten(keys(taggedFields).map(field => {
    switch (taggedFields[field].label) {
    case 'description':
      return {
        field,
        words: descriptionAsWords({description: args.description}).words,
      }

    case 'description_hash':
      if (!args.description_hash) {
        return {};
      }

      return {
        field,
        words: hexAsWords({hex: args.description_hash}).words,
      };

    case 'destination_public_key':
      return {
        field,
        words: hexAsWords({hex: args.destination}).words,
      };

    case 'expiry':
      if (!args.expires_at) {
        return {};
      }

      return {
        field,
        words: numberAsWords({number: expiresAtEpochTime - createdAt}).words,
      };

    case 'feature_bits':
      if (!args.features) {
        return {};
      }

      const bits = args.features.map(n => n.bit);

      return {
        field,
        words: featureFlagsAsWords({features: bits}).words,
      };

    case 'fallback_address':
      if (!args.chain_addresses) {
        return {};
      }

      return args.chain_addresses.map(address => ({
        field,
        words: chainAddressAsWords({address, network: args.network}).words,
      }));

    case 'metadata':
      if (!args.metadata) {
        return {};
      }

      return {
        field,
        words: hexAsWords({hex: args.metadata}),
      };

    case 'min_final_cltv_expiry':
      if (!args.cltv_delta) {
        return {};
      }

      return {
        field,
        words: numberAsWords({number: args.cltv_delta}).words,
      };

    case 'payment_hash':
      return {
        field,
        words: hexAsWords({hex: args.id}).words,
      };

    case 'payment_identifier':
      if (!args.payment) {
        return {};
      }

      return {
        field,
        words: hexAsWords({hex: args.payment}).words,
      };

    case 'routing':
      if (!args.routes) {
        return {};
      }

      return args.routes.map(route => {
        let pubKeyCursor;

        const paths = route.map(hop => {
          if (!hop.channel) {
            pubKeyCursor = hop.public_key;

            return;
          }

          const {hex} = hopAsHex({
            base_fee_mtokens: hop.base_fee_mtokens,
            channel: hop.channel,
            cltv_delta: hop.cltv_delta,
            fee_rate: hop.fee_rate,
            public_key: pubKeyCursor,
          });

          pubKeyCursor = hop.public_key;

          return hex;
        });

        const {words} = hexAsWords({hex: paths.filter(n => !!n).join('')});

        return {field, words};
      });

    default:
      throw new Error('UnexpectedTaggedFieldType');
    }
  }));

  const tagWords = fieldWords.filter(n => !!n.words).map(({field, words}) => {
    const typeWord = [parseInt(field, decBase)];

    const dataLengthWords = numberAsWords({number: words.length}).words;

    const dataLengthPadded = [0].concat(dataLengthWords).slice(-2);

    return [].concat(typeWord).concat(dataLengthPadded).concat(words);
  });

  const allTags = flatten(createdAtWords.concat(tagWords));

  const preimage = Buffer.concat([
    Buffer.from(hrp, 'ascii'),
    wordsAsBuffer({words: allTags}),
  ]);

  const hash = createHash('sha256').update(preimage).digest().toString('hex');

  return {hash, hrp, preimage: preimage.toString('hex'), tags: allTags};
};