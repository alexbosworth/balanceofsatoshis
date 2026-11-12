const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {decodePsbt} = require('psbt');
const {idForTransaction} = require('@alexbosworth/blockchain');
const {returnResult} = require('asyncjs-util');
const {updateGroupSigningSession} = require('ln-service');
const {v1HashToSign} = require('p2tr');

const beginSharedSessions = require('./begin_shared_sessions');
const findSharedDeposits = require('./find_shared_deposits');

const asOutpoint = input => `${input.id}:${input.vout}`;
const defaultSighash = 0;
const flatten = arr => [].concat(...arr);
const isActive = swap => !swap.is_canceled && !swap.is_swept;
const {keys} = Object;
const outpoint = n => `${n.transaction_id}:${n.transaction_vout}`;

/** Cosign a spend of shared address deposits that are not in a swap

  {
    addresses: [<Client Shared Address Object>]
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    nonces: {
      <Deposit Outpoint String>: <Client Nonce Hex String>
    }
    psbt: <Unsigned Spend PSBT Hex String>
    swaps: <Swaps In Keyed By Swap Hash Object>
  }

  @returns via cbk or Promise
  {
    id: <Spend Transaction Id Hex String>
    signatures: [{
      nonce: <Server Nonce Hex String>
      outpoint: <Deposit Outpoint String>
      signature: <Server Partial Signature Hex String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.addresses || !args.addresses.length) {
          return cbk([400, 'ExpectedClientAddressesToSignSharedUtxosSpend']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToSignSharedUtxosSpend']);
        }

        if (!args.network) {
          return cbk([400, 'ExpectedNetworkNameToSignSharedUtxosSpend']);
        }

        if (!args.nonces) {
          return cbk([400, 'ExpectedClientNoncesToSignSharedUtxosSpend']);
        }

        if (!args.psbt) {
          return cbk([400, 'ExpectedSpendPsbtToSignSharedUtxosSpend']);
        }

        if (!args.swaps) {
          return cbk([400, 'ExpectedSwapsToSignSharedUtxosSpend']);
        }

        return cbk();
      },

      // Decode the spend transaction
      spend: ['validate', ({}, cbk) => {
        try {
          decodePsbt({psbt: args.psbt});
        } catch (err) {
          return cbk([400, 'ExpectedValidPsbtToSignSharedUtxosSpend', {err}]);
        }

        const transaction = decodePsbt({psbt: args.psbt}).unsigned_transaction;

        const {inputs} = componentsOfTransaction({transaction});

        const outpoints = inputs.map(asOutpoint);

        if (outpoints.some(n => !args.nonces[n])) {
          return cbk([400, 'ExpectedClientNonceForEverySpendInput']);
        }

        return cbk(null, {outpoints, transaction});
      }],

      // Find the deposits being spent
      findDeposits: ['spend', ({spend}, cbk) => {
        return findSharedDeposits({
          addresses: args.addresses,
          lnd: args.lnd,
          network: args.network,
          outpoints: spend.outpoints,
        },
        cbk);
      }],

      // Check that the deposits are not locked to a swap
      checkDeposits: ['findDeposits', ({findDeposits}, cbk) => {
        const swaps = keys(args.swaps).map(hash => args.swaps[hash]);

        const active = swaps.filter(isActive);

        const locked = flatten(active.map(n => n.deposits.map(outpoint)));

        if (findDeposits.deposits.some(n => locked.includes(outpoint(n)))) {
          return cbk([400, 'ExpectedUnlockedDepositsToSpend']);
        }

        return cbk();
      }],

      // Begin a signing session for every deposit
      beginSessions: [
        'checkDeposits',
        'findDeposits',
        ({findDeposits}, cbk) =>
      {
        return beginSharedSessions({
          deposits: findDeposits.deposits,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Partially sign every input
      sign: [
        'beginSessions',
        'findDeposits',
        'spend',
        ({beginSessions, findDeposits, spend}, cbk) =>
      {
        const spends = findDeposits.deposits.map(deposit => ({
          script: deposit.address.output_script,
          tokens: deposit.tokens,
        }));

        const inputs = findDeposits.deposits.map((deposit, vin) => {
          return {deposit, vin};
        });

        return asyncMapSeries(inputs, ({deposit, vin}, cbk) => {
          const {hash} = v1HashToSign({
            spends,
            vin,
            sighash: defaultSighash,
            transaction: spend.transaction,
          });

          const session = beginSessions.sessions[vin];

          return updateGroupSigningSession({
            hash,
            id: session.id,
            lnd: args.lnd,
            nonces: [args.nonces[outpoint(deposit)]],
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {
              nonce: session.nonce,
              outpoint: outpoint(deposit),
              signature: res.signature,
            });
          });
        },
        cbk);
      }],

      // Spend signatures
      signatures: ['sign', 'spend', ({sign, spend}, cbk) => {
        return cbk(null, {
          id: idForTransaction({transaction: spend.transaction}).id,
          signatures: sign,
        });
      }],
    },
    returnResult({reject, resolve, of: 'signatures'}, cbk));
  });
};
