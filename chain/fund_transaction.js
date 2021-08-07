const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const {formatTokens} = require('ln-sync');
const {fundPsbt} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {signPsbt} = require('ln-service');
const {unlockUtxo} = require('ln-service');

const {parseAmount} = require('./../display');

const asOutpoint = utxo => `${utxo.transaction_id}:${utxo.transaction_vout}`;
const asInput = n => ({transaction_id: n.id, transaction_vout: n.vout});
const asUtxo = n => ({id: n.slice(0, 64), vout: Number(n.slice(65))});
const dustValue = 293;
const {isArray} = Array;
const isOutpoint = n => !!n && /^[0-9A-F]{64}:[0-9]{1,6}$/i.test(n);
const minConfs = 1;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());

/** Fund and sign a transaction

  {
    addresses: [<Address String>]
    amounts: [<Amount String>]
    spend: [<Coin Outpoint String>]
    [fee_tokens_per_vbyte]: <Fee Tokens Per Virtual Byte Number>
    is_dry_run: <Release Locks on Transaction Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    utxos: [<Unspent Transaction Outpoint String>]
  }

  @returns via cbk or Promise
  {
    signed_transaction: <Hex Encoded Raw Transaction String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToFundTransaction']);
        }

        if (!isArray(args.amounts)) {
          return cbk([400, 'ExpectedAddressesToFundTransaction']);
        }

        if (!isArray(args.addresses)) {
          return cbk([400, 'ExpectedAddressesToFundTransaction']);
        }

        if (!args.addresses.length) {
          return cbk([400, 'ExpectedAddressToSendFundsToInTransaction']);
        }

        if (args.addresses.length !== args.amounts.length) {
          return cbk([400, 'ExpectedAmountOfFundsToSendToAddress']);
        }

        if (!isArray(args.utxos)) {
          return cbk([400, 'ExpectedArrayOfUtxosToSpendToFundTransaction']);
        }

        if (args.utxos.find(n => !isOutpoint(n))) {
          return cbk([400, 'ExpectedOutpointFormattedUtxoToFundTransaction']);
        }

        return cbk();
      },

      // Get the current fee rate
      getFee: ['validate', ({}, cbk) => getChainFeeRate({lnd: args.lnd}, cbk)],

      // Derive exact outputs
      outputs: ['validate', ({}, cbk) => {
        try {
          const outputs = args.addresses.map((address, i) => {
            const {tokens} = parseAmount({amount: args.amounts[i]});

            return {address, tokens};
          });

          return cbk(null, outputs);
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Create a funded PSBT
      fund: ['getFee', 'outputs', ({getFee, outputs}, cbk) => {
        const inputs = args.utxos.map(asUtxo).map(asInput);
        const fee = args.fee_tokens_per_vbyte || getFee.tokens_per_vbyte;

        if (!!outputs.filter(n => n.tokens < dustValue).length) {
          return cbk([400, 'ExpectedNonDustAmountValueForFundingAmount']);
        }

        args.logger.info({
          fee_rate: fee,
          send_to: outputs.map(output => ({
            [output.address]: formatTokens({tokens: output.tokens}).display,
          })),
        });

        return fundPsbt({
          outputs,
          inputs: !!inputs.length ? inputs : undefined,
          lnd: args.lnd,
          fee_tokens_per_vbyte: fee,
        },
        cbk);
      }],

      // Unlock the locked UTXO in a dry run scenario
      unlock: ['fund', ({fund}, cbk) => {
        // Exit early and keep UTXOs locked when not a dry run
        if (!args.is_dry_run) {
          return cbk();
        }

        return asyncEach(fund.inputs, (input, cbk) => {
          return unlockUtxo({
            id: input.lock_id,
            lnd: args.lnd,
            transaction_id: input.transaction_id,
            transaction_vout: input.transaction_vout,
          },
          cbk);
        },
        cbk);
      }],

      // Sign the funded PSBT
      sign: ['fund', ({fund}, cbk) => {
        const [change] = fund.outputs.filter(n => !!n.is_change);
        const total = sumOf(fund.outputs.map(n => n.tokens));

        const tokens = !!change ? change.tokens : undefined;

        args.logger.info({
          change: !!tokens ? formatTokens({tokens}).display : undefined,
          sum_of_outputs: formatTokens({tokens: total}).display,
          spending_utxos: fund.inputs.map(asOutpoint),
        });

        return signPsbt({lnd: args.lnd, psbt: fund.psbt}, cbk);
      }],

      // Final funded transaction
      funded: ['sign', ({sign}, cbk) => {
        return cbk(null, {signed_transaction: sign.transaction});
      }],
    },
    returnResult({reject, resolve, of: 'funded'}, cbk));
  });
};
