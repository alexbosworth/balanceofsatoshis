const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncify = require('async/asyncify');
const asyncMap = require('async/map');
const asyncReflect = require('async/reflect');
const {broadcastTransaction} = require('ln-sync');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {createFundedPsbt} = require('ln-service');
const {formatTokens} = require('ln-sync');
const {getChainFeeRate} = require('ln-service');
const {getMaxFundingValue} = require('ln-sync');
const {getNetwork} = require('ln-sync');
const {getUtxos} = require('ln-service');
const {lockUtxo} = require('ln-service');
const {outputScriptForAddress} = require('@alexbosworth/blockchain');
const {parseAmount} = require('ln-accounting');
const {returnResult} = require('asyncjs-util');
const {signPsbt} = require('ln-service');
const {sizeOfTransaction} = require('@alexbosworth/blockchain');
const {unlockUtxo} = require('ln-service');

const asBigUnit = n => (n / 1e8).toFixed(8);
const asOutpoint = utxo => `${utxo.transaction_id}:${utxo.transaction_vout}`;
const asInput = n => ({transaction_id: n.id, transaction_vout: n.vout});
const asMtokens = tokens => Math.round(Number(tokens) * 1e3);
const asUtxo = n => ({id: n.slice(0, 64), vout: Number(n.slice(65))});
const dustValue = 293;
const formattedFeeRate = n => n.toFixed(2);
const hasMaxAmount = amounts => !!amounts.find(n => !!n && !!/max/gim.test(n));
const {isArray} = Array;
const isOutpoint = n => !!n && /^[0-9A-F]{64}:[0-9]{1,6}$/i.test(n);
const isPreciseFeeRate = n => !n || (Number.isSafeInteger(n) && n > 0);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const isValidFeeRate = n => !n || Number.isInteger(Number(n));
const mtokensPerToken = 1e3;
const noCoinSelectionMinConfs = 2147483647;
const placeholderTokens = 546;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());

/** Fund and sign a transaction

  {
    addresses: [<Address String>]
    amounts: [<Amount String>]
    ask: <Ask Function>
    [fee_mtokens_per_vbyte]: <Fee Millitokens Per Virtual Byte Number>
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

        if (!isValidFeeRate(args.fee_tokens_per_vbyte)) {
          return cbk([400, 'ExpectedIntegerFeeRateForFundingTransaction']);
        }

        if (!isPreciseFeeRate(args.fee_mtokens_per_vbyte)) {
          return cbk([400, 'ExpectedIntegerPreciseFeeRateToFundTransaction']);
        }

        if (!!args.fee_mtokens_per_vbyte && !!args.fee_tokens_per_vbyte) {
          return cbk([400, 'ExpectedEitherFeeRateOrPreciseFeeRateNotBoth']);
        }

        if (!!args.is_broadcast && !!args.is_dry_run) {
          return cbk([400, 'BroadcastingSignedTxUnsupportedInDryRun']);
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
      outputs: ['validate', asyncify(() => {
        // Exit early when the amount is open ended and thus depends on inputs
        if (hasMaxAmount(args.amounts)) {
          return;
        }

        try {
          const outputs = args.addresses.map((address, i) => {
            const {tokens} = parseAmount({amount: args.amounts[i]});

            return {address, tokens};
          });

          return outputs;
        } catch (err) {
          throw [400, err.message];
        }
      })],

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
          message: 'Select UTXOs to spend',
          name: 'inputs',
          type: 'checkbox',
          validate: input => {
            // A selection is required
            if (!input.length) {
              return false;
            }

            const tokens = sumOf(input.map(utxo => {
              return utxos.find(n => asOutpoint(n) === utxo.value).tokens;
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

      // Get the fee rate to fund at in mtokens per vbyte
      feeRate: ['getFee', ({getFee}, cbk) => {
        // Exit early when the fee rate is already in mtokens
        if (!!args.fee_mtokens_per_vbyte) {
          return cbk(null, args.fee_mtokens_per_vbyte);
        }

        const rate = args.fee_tokens_per_vbyte || getFee.tokens_per_vbyte;

        return cbk(null, asMtokens(rate));
      }],

      // Get the output scripts of the addresses to send to
      scripts: ['getNetwork', asyncify(({getNetwork}) => {
        const {network} = getNetwork;

        try {
          return args.addresses.map(address => {
            return outputScriptForAddress({address, network}).script;
          });
        } catch (err) {
          throw [400, err.message];
        }
      })],

      // Calculate the maximum possible amount to fund for selected inputs
      getMax: [
        'feeRate',
        'getUtxos',
        'scripts',
        'utxos',
        ({feeRate, getUtxos, scripts, utxos}, cbk) =>
      {
        // Exit early when the amount is not open ended
        if (!hasMaxAmount(args.amounts)) {
          return cbk(null, {});
        }

        // Because of anchor channel requirements, don't allow open ended max
        if (!utxos.length) {
          return cbk([400, 'MaxAmountOnlySupportedWhenUtxosSpecified']);
        }

        // Find the local UTXOs in order to get the input values
        const spend = utxos.map(outpoint => {
          return getUtxos.utxos.find(n => asOutpoint(n) === outpoint);
        });

        // Make sure that all inputs are known
        if (spend.filter(n => !n).length) {
          const knownUtxos = spend.filter(n => !!n);

          return cbk([400, 'UnknownInputSelected', {known: knownUtxos}]);
        }

        const [script, ...others] = scripts;

        // Size the max as the first output, with placeholders for the others
        return getMaxFundingValue({
          fee_mtokens_per_vbyte: feeRate,
          inputs: spend.map(utxo => ({
            transaction_id: utxo.transaction_id,
            transaction_vout: utxo.transaction_vout,
          })),
          lnd: args.lnd,
          output_script: script,
          outputs: others.map(n => ({script: n, tokens: placeholderTokens})),
        },
        cbk);
      }],

      // The value that the outputs can add up to when spending the max
      maxTokens: ['getMax', 'scripts', ({getMax, scripts}, cbk) => {
        // Exit early when there is no max amount
        if (getMax.max_tokens === undefined) {
          return cbk();
        }

        // Outputs after the first were sized with placeholder values
        const placeholders = scripts.slice(1).map(() => placeholderTokens);

        return cbk(null, getMax.max_tokens + sumOf(placeholders));
      }],

      // Parse amounts and put together the final set of outputs
      finalOutputs: [
        'maxTokens',
        'scripts',
        asyncify(({maxTokens, scripts}) =>
      {
        try {
          const outputs = args.addresses.map((address, i) => {
            const amount = args.amounts[i];
            const variables = {};

            // The max variable is only defined when a maximum is calculated
            if (maxTokens !== undefined) {
              variables.max = maxTokens;
            }

            const {tokens} = parseAmount({amount, variables});

            return {address, tokens, script: scripts[i]};
          });

          return outputs;
        } catch (err) {
          throw [400, err.message];
        }
      })],

      // Make sure that the outputs are not dust
      checkDust: ['finalOutputs', ({finalOutputs}, cbk) => {
        if (!!finalOutputs.filter(n => n.tokens < dustValue).length) {
          return cbk([400, 'ExpectedNonDustAmountValueForFundingAmount']);
        }

        return cbk();
      }],

      // Lock the inputs to spend, LND needs them locked before funding
      lock: ['checkDust', 'utxos', ({utxos}, cbk) => {
        return asyncMap(utxos.map(asUtxo), asyncReflect((utxo, cbk) => {
          return lockUtxo({
            lnd: args.lnd,
            transaction_id: utxo.id,
            transaction_vout: utxo.vout,
          },
          cbk);
        }),
        cbk);
      }],

      // The inputs that were locked, with the ids of their locks
      locked: ['lock', 'utxos', ({lock, utxos}, cbk) => {
        const inputs = utxos.map(asUtxo).map((utxo, i) => ({
          id: !lock[i].error ? lock[i].value.id : undefined,
          transaction_id: utxo.id,
          transaction_vout: utxo.vout,
        }));

        return cbk(null, inputs.filter(n => !!n.id));
      }],

      // Create a funded PSBT, holding on to a failure to unlock inputs first
      fund: [
        'feeRate',
        'finalOutputs',
        'lock',
        'locked',
        asyncReflect(({feeRate, finalOutputs, lock, locked}, cbk) =>
      {
        const [failed] = lock.filter(n => !!n.error);

        // Exit early when an input could not be locked
        if (!!failed) {
          return cbk(failed.error);
        }

        const minConfs = !!locked.length ? noCoinSelectionMinConfs : undefined;

        args.logger.info({
          send_to: finalOutputs.map(({address, tokens}) => ({
            [address]: formatTokens({tokens}).display,
          })),
          requested_fee_rate: feeRate / mtokensPerToken,
        });

        return createFundedPsbt({
          fee_mtokens_per_vbyte: feeRate,
          inputs: locked.map(input => ({
            transaction_id: input.transaction_id,
            transaction_vout: input.transaction_vout,
          })),
          lnd: args.lnd,
          // No coins are added to inputs that are specified to be spent
          min_confirmations: minConfs,
          outputs: finalOutputs.map(({script, tokens}) => ({script, tokens})),
        },
        cbk);
      })],

      // The funded PSBT, the inputs are unlocked when it could not be funded
      funding: ['fund', 'locked', ({fund, locked}, cbk) => {
        // Exit early when the PSBT was funded
        if (!fund.error) {
          return cbk(null, fund.value);
        }

        return asyncEach(locked, (input, cbk) => {
          return unlockUtxo({
            id: input.id,
            lnd: args.lnd,
            transaction_id: input.transaction_id,
            transaction_vout: input.transaction_vout,
          },
          () => {
            // Ignore errors unlocking a UTXO, the lock will expire on its own
            return cbk();
          });
        },
        () => {
          // Return the original error that stopped funding
          return cbk(fund.error);
        });
      }],

      // Sign the funded PSBT
      sign: ['funding', ({funding}, cbk) => {
        const [change] = funding.outputs.filter(n => !!n.is_change);
        const total = sumOf(funding.outputs.map(n => n.tokens));

        const tokens = !!change ? change.tokens : undefined;

        args.logger.info({
          change: !!tokens ? formatTokens({tokens}).display : undefined,
          sum_of_outputs: formatTokens({tokens: total}).display,
          spending_utxos: funding.inputs.map(asOutpoint),
        });

        return signPsbt({lnd: args.lnd, psbt: funding.psbt}, cbk);
      }],

      // Unlock the locked UTXOs in a dry run scenario
      unlock: ['funding', 'locked', 'sign', ({funding, locked}, cbk) => {
        // Exit early and keep UTXOs locked when not a dry run
        if (!args.is_dry_run) {
          return cbk();
        }

        // LND locks the inputs that it adds to fund the PSBT
        const added = funding.inputs.filter(n => !!n.lock_id).map(input => ({
          id: input.lock_id,
          transaction_id: input.transaction_id,
          transaction_vout: input.transaction_vout,
        }));

        return asyncEach(locked.concat(added), (input, cbk) => {
          return unlockUtxo({
            id: input.id,
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
        const tx = componentsOfTransaction({transaction: sign.transaction});

        // Find the UTXOs that are being spent in the final transaction
        const spending = tx.inputs.map(input => {
          const outpoint = asOutpoint({
            transaction_id: input.id,
            transaction_vout: input.vout,
          });

          return getUtxos.utxos.find(n => asOutpoint(n) === outpoint);
        });

        // Make sure the spending UTXOs are known
        if (spending.filter(n => !n).length) {
          return cbk([503, 'ExpectedSpendingKnownUtxosForFundedTx']);
        }

        const inputsValue = sumOf(spending.map(n => n.tokens));
        const outputsValue = sumOf(tx.outputs.map(n => n.tokens));

        const feeTotal = inputsValue - outputsValue;

        const {vsize} = sizeOfTransaction({transaction: sign.transaction});

        return cbk(null, {
          fee_tokens_per_vbyte: formattedFeeRate(feeTotal / vsize),
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
      }],
    },
    returnResult({reject, resolve, of: 'broadcast'}, cbk));
  });
};
