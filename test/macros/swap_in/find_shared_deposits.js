const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getHeight} = require('ln-service');
const {getSharedUtxos} = require('goldengate');
const {returnResult} = require('asyncjs-util');

const {swapInDepositConfs} = require('./../constants');

const confirmations = (height, utxo) => height - utxo.confirmation_height + 1;
const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const outpoint = n => `${n.transaction_id}:${n.transaction_vout}`;

/** Find the confirmed deposits of a client to its shared addresses

  {
    addresses: [{
      address: <Shared Address String>
      output_script: <Shared Address Output Script Hex String>
      root_hash: <Shared Address Script Tree Root Hash Hex String>
      server_index: <Server Key Index Number>
      start_height: <Shared Address Creation Chain Height Number>
    }]
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    outpoints: [<Deposit Outpoint String>]
  }

  @returns via cbk or Promise
  {
    deposits: [{
      address: <Shared Address Object>
      confirmation_height: <Deposit Confirmation Height Number>
      tokens: <Deposit Tokens Number>
      transaction_id: <Deposit Transaction Id Hex String>
      transaction_vout: <Deposit Transaction Output Index Number>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.addresses)) {
          return cbk([400, 'ExpectedSharedAddressesToFindSharedDeposits']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToFindSharedDeposits']);
        }

        if (!args.network) {
          return cbk([400, 'ExpectedNetworkNameToFindSharedDeposits']);
        }

        if (!isArray(args.outpoints) || !args.outpoints.length) {
          return cbk([400, 'ExpectedDepositOutpointsToFindSharedDeposits']);
        }

        return cbk();
      },

      // Get the current height to count confirmations
      getHeight: ['validate', ({}, cbk) => getHeight({lnd: args.lnd}, cbk)],

      // Scan for the utxos of every address
      getUtxos: ['validate', ({}, cbk) => {
        return asyncMap(args.addresses, (address, cbk) => {
          return getSharedUtxos({
            address: address.address,
            lnd: args.lnd,
            min_height: address.start_height,
            network: args.network,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, res.utxos.map(utxo => ({
              address,
              confirmation_height: utxo.confirmation_height,
              tokens: utxo.tokens,
              transaction_id: utxo.transaction_id,
              transaction_vout: utxo.transaction_vout,
            })));
          });
        },
        cbk);
      }],

      // Match every outpoint to a confirmed utxo, or fail
      deposits: ['getHeight', 'getUtxos', ({getHeight, getUtxos}, cbk) => {
        const utxos = flatten(getUtxos);

        const deposits = args.outpoints.map(id => {
          return utxos.find(utxo => outpoint(utxo) === id.toLowerCase());
        });

        if (deposits.some(n => !n)) {
          return cbk([400, 'ExpectedKnownDepositOutpointsForClient']);
        }

        const height = getHeight.current_block_height;

        const isPending = n => confirmations(height, n) < swapInDepositConfs;

        if (deposits.some(isPending)) {
          return cbk([400, 'ExpectedConfirmedDepositsForClient']);
        }

        return cbk(null, {deposits});
      }],
    },
    returnResult({reject, resolve, of: 'deposits'}, cbk));
  });
};
