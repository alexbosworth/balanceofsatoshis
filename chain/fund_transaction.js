const asyncAuto = require('async/auto');
const {formatTokens} = require('ln-sync');
const {fundPsbt} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {signPsbt} = require('ln-service');

const {parseAmount} = require('./../display');

const asOutpoint = utxo => `${utxo.transaction_id}:${utxo.transaction_vout}`;
const {isArray} = Array;

/** Fund and sign a transaction

  {
    addresses: <Address String>
    amount: <Amount String>
    [fee_tokens_per_vbyte]: <Fee Tokens Per Virtual Byte Number>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
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

        return cbk();
      },

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
      fund: ['outputs', ({outputs}, cbk) => {
        args.logger.info({
          spend: outputs.map(output => ({
            [output.address]: formatTokens({tokens: output.tokens}).display,
          })),
        });

        return fundPsbt({
          outputs,
          lnd: args.lnd,
          fee_tokens_per_vbyte: args.fee_tokens_per_vbyte,
        },
        cbk);
      }],

      // Sign the funded PSBT
      sign: ['fund', ({fund}, cbk) => {
        const [change] = fund.outputs.filter(n => !!n.is_change);

        const tokens = !!change ? change.tokens : undefined;

        args.logger.info({
          change: !!tokens ? formatTokens({tokens}).display : undefined,
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
