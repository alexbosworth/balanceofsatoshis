const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const {getPublicKey} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {sharedAddressScript} = require('goldengate');

const {keyFamily} = require('./../constants');
const {sharedAddressExpiry} = require('./../constants');

/** Create a shared address with a client key

  {
    client_key: <Client Public Key Hex String>
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    start_height: <Chain Height Number>
  }

  @returns via cbk or Promise
  {
    address: <Shared Address String>
    client_key: <Client Public Key Hex String>
    expiry: <Shared Address Expiry Blocks Count Number>
    output_script: <Shared Address Output Script Hex String>
    root_hash: <Shared Address Script Tree Root Hash Hex String>
    server_index: <Server Key Index Number>
    server_key: <Server Public Key Hex String>
    start_height: <Shared Address Creation Chain Height Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.client_key) {
          return cbk([400, 'ExpectedClientKeyToCreateSharedAddress']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToCreateSharedAddress']);
        }

        if (!args.network) {
          return cbk([400, 'ExpectedNetworkNameToCreateSharedAddress']);
        }

        if (!args.start_height) {
          return cbk([400, 'ExpectedStartHeightToCreateSharedAddress']);
        }

        return cbk();
      },

      // Get the server key for the shared address
      getKey: ['validate', ({}, cbk) => {
        return getPublicKey({family: keyFamily, lnd: args.lnd}, cbk);
      }],

      // Derive the shared address
      address: ['getKey', asyncify(({getKey}) => {
        try {
          const address = sharedAddressScript({
            client_public_key: args.client_key,
            expiry: sharedAddressExpiry,
            network: args.network,
            server_public_key: getKey.public_key,
          });

          return {
            address: address.address,
            client_key: args.client_key,
            expiry: sharedAddressExpiry,
            output_script: address.output_script,
            root_hash: address.root_hash,
            server_index: getKey.index,
            server_key: getKey.public_key,
            start_height: args.start_height,
          };
        } catch (err) {
          throw [400, 'FailedToDeriveSharedAddressForClientKey', {err}];
        }
      })],
    },
    returnResult({reject, resolve, of: 'address'}, cbk));
  });
};
