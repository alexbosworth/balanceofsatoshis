const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const {createInvoice} = require('ln-service');
const {encodeTlvStream} = require('bolt01');
const {returnResult} = require('asyncjs-util');

const expiry = () => new Date(Date.now() + (1000 * 60 * 5)).toISOString();
const hexAsBase64 = hex => Buffer.from(hex, 'hex').toString('base64');
const {isArray} = Array;
const isHex = n => !!n && !(n.length % 2) && /^[0-9A-F]*$/i.test(n);
const makeSecret = () => randomBytes(32).toString('hex');

/** Simulate a key send request with an invoice that encodes TLV records

  {
    lnd: <Authenticated LND API Object>
    tokens: <Tokens Received Number>
    types: [<Message Type String>]
    values: [<Value Hex String>]
  }
*/
module.exports = ({lnd, tokens, types, values}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToSimulateKeySendRequest']);
        }

        if (!tokens) {
          return cbk([400, 'ExpectedTokensAmountToSimulateKeySendRequest']);
        }

        if (!isArray(types) || !types.length) {
          return cbk([400, 'ExpectedArrayOfTypesToSimulateKeySendRequest']);
        }

        if (!isArray(values) || !values.length) {
          return cbk([400, 'ExpectedArrayOfValuesToSimulateKeySendRequest']);
        }

        if (types.length !== values.length) {
          return cbk([400, 'ExpectedEqualNumbersOfTypesToValues']);
        }

        return cbk();
      },

      // Map types and values into message records and encode that as TLV
      description: ['validate', ({}, cbk) => {
        try {
          // Zip together type and value arrays into consolidated records
          const records = types.map((type, i) => {
            if (!BigInt(type)) {
              throw new Error('ExpectedTypeNumberForMessages');
            }

            if (!isHex(values[i])) {
              throw new Error('ExpectedHexValueForMessages');
            }

            return {type, value: values[i]};
          });

          // Encode messages as a BOLT 1 TLV stream
          const {encoded} = encodeTlvStream({records});

          return cbk(null, hexAsBase64(encoded));
        } catch (err) {
          return cbk([400, 'FailedToEncodeRecordsAsTlvStream', {err}]);
        }
      }],

      // Create simulated key send invoice
      createInvoice: ['description', ({description}, cbk) => {
        // To indicate this is a false invoice, the secret will be used as the
        // description hash, which is not a normal way to create an invoice and
        // would be dangerous to do for a public payment request.
        const secret = makeSecret();

console.log("CREATE", {
          description,
          secret,
          tokens,
          description_hash: secret,
          expires_at: expiry(),
})

        return createInvoice({
          description,
          lnd,
          secret,
          tokens,
          description_hash: secret,
          expires_at: expiry(),
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
