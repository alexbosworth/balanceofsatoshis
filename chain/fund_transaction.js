const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const {broadcastTransaction} = require('ln-sync');
const {formatTokens} = require('ln-sync');
const {fundPsbt} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {getMaxFundAmount} = require('ln-sync');
const {getNetwork} = require('ln-sync');
const {getUtxos} = require('ln-service');
const {parseAmount} = require('ln-accounting');
const {returnResult} = require('asyncjs-util');
const {signPsbt} = require('ln-service');
const {Transaction} = require('bitcoinjs-lib');
const {unlockUtxo} = require('ln-service');

const allowUnconfirmed = 0;
const asBigUnit = n => (n / 1e8).toFixed(8);
const asOutpoint = utxo => `${utxo.transaction_id}:${utxo.transaction_vout}`;
const asInput = n => ({transaction_id: n.id, transaction_vout: n.vout});
const asUtxo = n => ({id: n.slice(0, 64), vout: Number(n.slice(65))});
const bufferAsHex = buffer => buffer.toString('hex');
const dustValue = 293;
const formattedFeeRate = n => n.toFixed(2);
const {fromHex} = Transaction;
const hasMaxAmount = amounts => !!amounts.find(n => !!n && !!/max/gim.test(n));
const {isArray} = Array;
const isOutpoint = n => !!n && /^[0-9A-F]{64}:[0-9]{1,6}$/i.test(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const minConfs = 1;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const taprootAddressVersion = 1;
const txHashAsTxId = hash => hash.reverse().toString('hex');

/** Fund and sign a transaction

  {
    addresses: [<Address String>]
    amounts: [<Amount String>]
    ask: <Ask Function>
    spend: [<Coin Outpoint String>]
    [fee_tokens_per_vbyte]: <Fee Tokens Per Virtual Byte Number>
    [is_broadcast]: <Broadcast Signed Transaction Bool>
    is_dry_run: <Release Locks on Transaction Bool>
    [is_selecting_utxos]: <Interactively Select UTXOs to Spend Bool>
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

        if (!!args.addresses.find(n => isPublicKey(n))) {
          return cbk([400, 'ExpectedFundPayingToAddressesNotPublicKeys']);
        }

        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToFundTransaction']);
        }

        if (!isArray(args.utxos)) {
          return cbk([400, 'ExpectedArrayOfUtxosToSpendToFundTransaction']);
        }

        if (args.utxos.find(n => !isOutpoint(n))) {
          return cbk([400, 'ExpectedOutpointFormattedUtxoToFundTransaction']);
        }

        if (!!args.utxos.length && !!args.is_selecting_utxos) {
          return cbk([400, 'ExpectedEitherSelectUtxosOrExplicitUtxosNotBoth']);
        }

        return cbk();
      },

      // Get the current fee rate
      getFee: ['validate', ({}, cbk) => getChainFeeRate({lnd: args.lnd}, cbk)],

      // Get the network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Derive a list of outputs to guide input selection
      outputs: ['validate', ({}, cbk) => {
        // Exit early when the amount is open ended and thus depends on inputs
        if (hasMaxAmount(args.amounts)) {
          return cbk();
        }

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

      // Get UTXOs to use for input selection and final fee rate calculation
      getUtxos: ['validate', ({}, cbk) => getUtxos({lnd: args.lnd}, cbk)],

      // Select inputs to spend
      utxos: ['getUtxos', 'outputs', ({getUtxos, outputs}, cbk) => {
        // Exit early when UTXOs are all specified already
        if (!!args.utxos.length) {
          return cbk(null, args.utxos);
        }

        // Exit early when not selecting UTXOs interactively
        if (!args.is_selecting_utxos) {
          return cbk(null, []);
        }

        // Only selecting confirmed utxos is supported
        const utxos = getUtxos.utxos.filter(n => !!n.confirmation_count);

        // Make sure there are some UTXOs to select
        if (!utxos.length) {
          return cbk([400, 'WalletHasZeroConfirmedUtxos']);
        }

        return args.ask({
          choices: utxos.map(utxo => ({
            name: `${asBigUnit(utxo.tokens)} ${asOutpoint(utxo)}`,
            value: asOutpoint(utxo),
          })),
          loop: false,
          name: 'inputs',
          type: 'checkbox',
          validate: input => {
            // A selection is required
            if (!input.length) {
              return false;
            }

            const tokens = sumOf(input.map(utxo => {
              return utxos.find(n => asOutpoint(n) === utxo).tokens;
            }));

            // Exit early when the amount is open ended
            if (hasMaxAmount(args.amounts)) {
              return true;
            }

            const amounts = outputs.map(n => n.tokens);

            const missingTok = asBigUnit(sumOf(amounts) - tokens);

            if (tokens < sumOf(amounts)) {
              return `Selected ${asBigUnit(tokens)}, need ${missingTok} more`;
            }

            return true;
          }
        },
        ({inputs}) => cbk(null, inputs));
      }],

      // Calculate the maximum possible amount to fund for selected inputs
      getMax: [
        'getFee',
        'getUtxos',
        'outputs',
        'utxos',
        ({getFee, getUtxos, outputs, utxos}, cbk) =>
      {
        // Exit early when the amount is not open ended
        if (!hasMaxAmount(args.amounts)) {
          return cbk(null, {});
        }

        // Because of anchor channel requirements, don't allow open ended max
        if (!utxos.length) {
          return cbk([400, 'MaxAmountOnlySupportedWhenUtxosSpecified']);
        }

        const feeRate = args.fee_tokens_per_vbyte || getFee.tokens_per_vbyte;

        // Find the local UTXOs in order to get the input values
        const spend = utxos.map(outpoint => {
          return getUtxos.utxos.find(n => asOutpoint(n) === outpoint);
        });

        // Make sure that all inputs are known
        if (spend.filter(n => !n).length) {
          return cbk([400, 'UnknownInputSelected', {known_utxos: spend}]);
        }

        return getMaxFundAmount({
          addresses: args.addresses,
          fee_tokens_per_vbyte: feeRate,
          inputs: spend.map(utxo => ({
            tokens: utxo.tokens,
            transaction_id: utxo.transaction_id,
            transaction_vout: utxo.transaction_vout,
          })),
          lnd: args.lnd,
        },
        cbk);
      }],

      // Parse amounts and put together the final set of outputs
      finalOutputs: ['getMax', ({getMax}, cbk) => {
        try {
          const outputs = args.addresses.map((address, i) => {
            const amount = args.amounts[i];
            const variables = {max: getMax.max_tokens};

            return {address, tokens: parseAmount({amount, variables}).tokens};
          });

          return cbk(null, outputs);
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Create a funded PSBT
      fund: [
        'finalOutputs',
        'getFee',
        'getNetwork',
        'utxos',
        ({finalOutputs, getFee, getNetwork, utxos}, cbk) =>
      {
        const inputs = utxos.map(asUtxo).map(asInput);
        const feeRate = args.fee_tokens_per_vbyte || getFee.tokens_per_vbyte;

        if (!!finalOutputs.filter(n => n.tokens < dustValue).length) {
          return cbk([400, 'ExpectedNonDustAmountValueForFundingAmount']);
        }

        args.logger.info({
          send_to: finalOutputs.map(({address, tokens}) => ({
            [address]: formatTokens({tokens}).display,
          })),
          requested_fee_rate: feeRate,
        });

        return fundPsbt({
          fee_tokens_per_vbyte: feeRate,
          inputs: !!inputs.length ? inputs : undefined,
          lnd: args.lnd,
          min_confirmations: !!inputs.length ? allowUnconfirmed : undefined,
          outputs: finalOutputs,
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

      // Unlock the locked UTXOs in a dry run scenario
      unlock: ['fund', 'sign', ({fund}, cbk) => {
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

      // Final funded transaction
      funded: ['getUtxos', 'sign', ({getUtxos, sign}, cbk) => {
        // Match the inputs of the tx up to the wallet outputs
        const tx = fromHex(sign.transaction);

        // Find the UTXOs that are being spent in the final transaction
        const spending = tx.ins.map(input => {
          const outpoint = asOutpoint({
            transaction_id: txHashAsTxId(input.hash),
            transaction_vout: input.index,
          });

          return getUtxos.utxos.find(n => asOutpoint(n) === outpoint);
        });

        // Make sure the spending UTXOs are known
        if (spending.filter(n => !n).length) {
          return cbk([503, 'ExpectedSpendingKnownUtxosForFundedTx']);
        }

        const inputsValue = sumOf(spending.map(n => n.tokens));
        const outputsValue = sumOf(tx.outs.map(n => n.value));

        const feeTotal = inputsValue - outputsValue;

        return cbk(null, {
          fee_tokens_per_vbyte: formattedFeeRate(feeTotal / tx.virtualSize()),
          signed_transaction: sign.transaction,
        });
      }],

      // Broadcast the signed transaction
      broadcast: ['funded', ({funded}, cbk) => {
        // Exit early when not broadcasting the transaction
        if (!args.is_broadcast) {
          return cbk(null, {
            fee_tokens_per_vbyte: funded.fee_tokens_per_vbyte,
            signed_transaction: funded.signed_transaction,
          });
        }

        args.logger.info({
          fee_tokens_per_vbyte: funded.fee_tokens_per_vbyte,
          signed_transaction: funded.signed_transaction,
        });

        return broadcastTransaction({
          lnd: args.lnd,
          logger: args.logger,
          transaction: funded.signed_transaction,
        },
        cbk);
      }]
    },
    returnResult({reject, resolve, of: 'broadcast'}, cbk));
  });
};
