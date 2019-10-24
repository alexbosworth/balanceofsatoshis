const asyncAuto = require('async/auto');
const {createChainAddress} = require('ln-service');
const qrcode = require('qrcode-terminal');
const {returnResult} = require('asyncjs-util');

const bigTok = tokens => !tokens ? '0' : (tokens / 1e8).toFixed(8);
const format = 'p2wpkh';

/** Get deposit address

  {
    lnd: <Authenticated LND gRPC API Object>
    [tokens]: <Tokens to Receive Number>
  }

  @returns via cbk or Promise
  {
    deposit_address: <Deposit Address String>
    deposit_qr: <Deposit Address URL QR Code String>
  }
*/
module.exports = ({lnd, tokens}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetDepositAddress']);
        }

        return cbk();
      },

      // Get an address
      getAddress: ['validate', ({}, cbk) => {
        return createChainAddress({format, lnd, is_unused: true}, cbk);
      }],

      // Get a QR code for the address URL
      qr: ['getAddress', ({getAddress}, cbk) => {
        const url = `bitcoin:${getAddress.address}?amount=${bigTok(tokens)}`;

        return qrcode.generate(url, {small: true}, code => cbk(null, code));
      }],

      // Address details and QR
      address: ['getAddress', 'qr', ({getAddress, qr}, cbk) => {
        return cbk(null, {
          deposit_address: getAddress.address,
          deposit_qr: qr,
        });
      }],
    },
    returnResult({reject, resolve, of: 'address'}, cbk));
  });
};
