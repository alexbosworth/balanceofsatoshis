const EventEmitter = require('events');
const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {numberAsCompactInt} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');
const {unsignedTxFromPsbt} = require('@alexbosworth/blockchain');

const {fundTransaction} = require('./../../chain');
const {getInfoResponse} = require('./../fixtures');

const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const addressScript = '0014e8df018c7e326cc253faac7e46cdc51e68542c42';
const changeScript = Buffer.alloc(22, 1).toString('hex');
const fee = 1000;
const lockId = Buffer.alloc(32, 2);
const maxSequence = 4294967295;
const outpoint = `${Buffer.alloc(32).toString('hex')}:0`;
const psbtMagic = Buffer.from('70736274ff', 'hex');
const psbtMapSeparator = Buffer.alloc(1);
const psbtUnsignedTxKey = Buffer.from('0100', 'hex');
const spendTxId = Buffer.alloc(32).toString('hex');
const unknownTxId = Buffer.alloc(32, 3).toString('hex');
const utxoTokens = 100000;

// Build an unsigned transaction from funding outputs, adding change if any
const makeTx = ({outputs, txId}) => {
  const funding = Object.keys(outputs).map(address => ({
    script: addressScript,
    tokens: Number(outputs[address]),
  }));

  const spending = funding.reduce((sum, n) => sum + n.tokens, 0);

  const change = utxoTokens - spending - fee;

  const changeOutputs = [{script: changeScript, tokens: change}].filter(n => {
    return n.tokens > 0;
  });

  const {transaction} = transactionFromComponents({
    inputs: [{id: txId, script: '', sequence: maxSequence, vout: 0}],
    locktime: 0,
    outputs: [].concat(funding).concat(changeOutputs),
    version: 2,
  });

  const tx = Buffer.from(transaction, 'hex');

  // A minimal PSBT has the unsigned tx as its only global and empty in/outs
  const psbt = Buffer.concat([
    psbtMagic,
    psbtUnsignedTxKey,
    numberAsCompactInt({number: tx.length}).encoded,
    tx,
    psbtMapSeparator,
    psbtMapSeparator,
    ...funding.concat(changeOutputs).map(() => psbtMapSeparator),
  ]);

  return {
    change_output_index: change > 0 ? funding.length : -1,
    psbt,
    transaction,
  };
};

// Make a subscription stream that emits data on the next tick
const makeStream = data => {
  const stream = new EventEmitter();

  stream.cancel = () => {};

  setImmediate(() => stream.emit('data', data));

  return stream;
};

const makeLnd = ({txId}) => {
  let lastTx;

  const lnd = {
    chain: {
      registerBlockEpochNtfn: ({}) => makeStream({
        hash: Buffer.alloc(32),
        height: 1000,
      }),
      registerConfirmationsNtfn: ({}) => makeStream({
        conf: {
          block_hash: Buffer.alloc(32),
          block_height: 1001,
          raw_tx: Buffer.from(lastTx, 'hex'),
        },
      }),
    },
    default: {
      getInfo: ({}, cbk) => cbk(null, getInfoResponse),
    },
    wallet: {
      estimateFee: ({}, cbk) => cbk(null, {sat_per_kw: '2500'}),
      listUnspent: ({}, cbk) => cbk(null, {
        utxos: [{
          address,
          address_type: 'WITNESS_PUBKEY_HASH',
          amount_sat: String(utxoTokens),
          confirmations: '1',
          outpoint: {output_index: 0, txid_str: spendTxId},
          pk_script: changeScript,
        }],
      }),
      finalizePsbt: ({funded_psbt}, cbk) => {
        const psbt = funded_psbt.toString('hex');

        lastTx = unsignedTxFromPsbt({psbt}).transaction.toString('hex');

        return cbk(null, {
          raw_final_tx: Buffer.from(lastTx, 'hex'),
          signed_psbt: funded_psbt,
        });
      },
      fundPsbt: ({raw}, cbk) => {
        const funded = makeTx({outputs: raw.outputs, txId: txId || spendTxId});

        return cbk(null, {
          change_output_index: funded.change_output_index,
          funded_psbt: funded.psbt,
          locked_utxos: [{
            expiration: '1',
            id: lockId,
            outpoint: {
              output_index: 0,
              txid_bytes: Buffer.from(spendTxId, 'hex').reverse(),
            },
          }],
        });
      },
      publishTransaction: ({}, cbk) => cbk(null, {}),
      releaseOutput: ({}, cbk) => cbk(null, {}),
    },
  };

  // The legacy UTXOs method signals UTXO listing support
  lnd.default.listUnspent = lnd.wallet.listUnspent;

  return lnd;
};

// Ask function that exercises input validation then selects the given inputs
const makeAsk = ({checks, select}) => ({choices, validate}, cbk) => {
  (checks || []).forEach(({expected, input}) => {
    deepEqual(validate(input), expected, 'Got expected validation result');
  });

  return cbk({inputs: select || choices.map(n => n.value)});
};

const makeArgs = overrides => {
  const args = {
    addresses: [address],
    amounts: ['50000'],
    ask: makeAsk({}),
    lnd: makeLnd({}),
    logger: {info: () => {}},
    utxos: [],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// The expected signed transaction for a set of outputs
const expectedTx = outputs => makeTx({outputs, txId: spendTxId}).transaction;

const tests = [
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedAuthenticatedLndToFundTransaction'],
  },
  {
    args: makeArgs({amounts: undefined}),
    description: 'Amounts are required',
    error: [400, 'ExpectedAddressesToFundTransaction'],
  },
  {
    args: makeArgs({addresses: undefined}),
    description: 'Addresses are required',
    error: [400, 'ExpectedAddressesToFundTransaction'],
  },
  {
    args: makeArgs({addresses: [], amounts: []}),
    description: 'An address is required',
    error: [400, 'ExpectedAddressToSendFundsToInTransaction'],
  },
  {
    args: makeArgs({amounts: []}),
    description: 'An amount is required for each address',
    error: [400, 'ExpectedAmountOfFundsToSendToAddress'],
  },
  {
    args: makeArgs({addresses: [getInfoResponse.identity_pubkey]}),
    description: 'Public keys are not addresses',
    error: [400, 'ExpectedFundPayingToAddressesNotPublicKeys'],
  },
  {
    args: makeArgs({ask: undefined}),
    description: 'An ask function is required',
    error: [400, 'ExpectedAskFunctionToFundTransaction'],
  },
  {
    args: makeArgs({fee_tokens_per_vbyte: 1.5}),
    description: 'An integer fee rate is required',
    error: [400, 'ExpectedIntegerFeeRateForFundingTransaction'],
  },
  {
    args: makeArgs({is_broadcast: true, is_dry_run: true}),
    description: 'Broadcasting is not supported in a dry run',
    error: [400, 'BroadcastingSignedTxUnsupportedInDryRun'],
  },
  {
    args: makeArgs({utxos: undefined}),
    description: 'An array of UTXOs is required',
    error: [400, 'ExpectedArrayOfUtxosToSpendToFundTransaction'],
  },
  {
    args: makeArgs({utxos: ['utxo']}),
    description: 'UTXOs must be outpoints',
    error: [400, 'ExpectedOutpointFormattedUtxoToFundTransaction'],
  },
  {
    args: makeArgs({is_selecting_utxos: true, utxos: [outpoint]}),
    description: 'Either select UTXOs or specify them, not both',
    error: [400, 'ExpectedEitherSelectUtxosOrExplicitUtxosNotBoth'],
  },
  {
    args: makeArgs({amounts: ['']}),
    description: 'A valid amount is required',
    error: [400, 'ExpectedCompleteFormulaForParsing'],
  },
  {
    args: makeArgs({
      addresses: [address, address],
      amounts: ['max', ''],
      utxos: [outpoint],
    }),
    description: 'Valid amounts are required alongside a max amount',
    error: [400, 'ExpectedCompleteFormulaForParsing'],
  },
  {
    args: makeArgs({
      is_selecting_utxos: true,
      lnd: (() => {
        const lnd = makeLnd({});

        lnd.wallet.listUnspent = ({}, cbk) => cbk(null, {utxos: []});

        return lnd;
      })(),
    }),
    description: 'Selecting UTXOs requires confirmed UTXOs',
    error: [400, 'WalletHasZeroConfirmedUtxos'],
  },
  {
    args: makeArgs({amounts: ['max']}),
    description: 'A max amount requires specified UTXOs',
    error: [400, 'MaxAmountOnlySupportedWhenUtxosSpecified'],
  },
  {
    args: makeArgs({amounts: ['max'], utxos: [`${unknownTxId}:0`]}),
    description: 'A max amount requires known UTXOs',
    error: [400, 'UnknownInputSelected', {known: []}],
  },
  {
    args: makeArgs({amounts: ['1']}),
    description: 'A non-dust amount is required',
    error: [400, 'ExpectedNonDustAmountValueForFundingAmount'],
  },
  {
    args: makeArgs({lnd: makeLnd({txId: unknownTxId})}),
    description: 'The funded transaction must spend known UTXOs',
    error: [503, 'ExpectedSpendingKnownUtxosForFundedTx'],
  },
  {
    args: makeArgs({}),
    description: 'Fund a transaction',
    expected: {
      fee_tokens_per_vbyte: '8.85',
      signed_transaction: expectedTx({[address]: '50000'}),
    },
  },
  {
    args: makeArgs({fee_tokens_per_vbyte: 5, is_dry_run: true}),
    description: 'Fund a transaction in a dry run with a fee rate',
    expected: {
      fee_tokens_per_vbyte: '8.85',
      signed_transaction: expectedTx({[address]: '50000'}),
    },
  },
  {
    args: makeArgs({amounts: ['max'], utxos: [outpoint]}),
    description: 'Fund a transaction spending the max amount',
    expected: {
      fee_tokens_per_vbyte: '12.20',
      signed_transaction: expectedTx({[address]: '99000'}),
    },
  },
  {
    args: makeArgs({
      amounts: ['max'],
      fee_tokens_per_vbyte: 5,
      utxos: [outpoint],
    }),
    description: 'Fund a max amount transaction with a fee rate',
    expected: {
      fee_tokens_per_vbyte: '12.20',
      signed_transaction: expectedTx({[address]: '99000'}),
    },
  },
  {
    args: makeArgs({
      ask: makeAsk({
        checks: [{
          expected: 'Selected 0.00100000, need 0.00900000 more',
          input: [{value: outpoint}],
        }],
      }),
      amounts: ['1000000'],
      is_selecting_utxos: true,
      lnd: (() => {
        const lnd = makeLnd({});

        lnd.wallet.fundPsbt = ({}, cbk) => cbk({details: 'insufficient'});

        return lnd;
      })(),
    }),
    description: 'Selecting UTXOs requires enough value to fund outputs',
    error: [
      503,
      'UnexpectedErrorFundingTransaction',
      {err: {details: 'insufficient'}},
    ],
  },
  {
    args: makeArgs({
      ask: makeAsk({
        checks: [
          {expected: false, input: []},
          {expected: true, input: [{value: outpoint}]},
        ],
      }),
      is_selecting_utxos: true,
    }),
    description: 'Fund a transaction with selected UTXOs',
    expected: {
      fee_tokens_per_vbyte: '8.85',
      signed_transaction: expectedTx({[address]: '50000'}),
    },
  },
  {
    args: makeArgs({
      ask: makeAsk({checks: [{expected: true, input: [{value: outpoint}]}]}),
      amounts: ['max'],
      is_selecting_utxos: true,
    }),
    description: 'Fund a max amount transaction with selected UTXOs',
    expected: {
      fee_tokens_per_vbyte: '12.20',
      signed_transaction: expectedTx({[address]: '99000'}),
    },
  },
  {
    args: makeArgs({is_broadcast: true}),
    description: 'Fund and broadcast a transaction',
    expected: {transaction_confirmed_in_block: 1001},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(fundTransaction(args), error, 'Got expected error');
    } else {
      deepEqual(await fundTransaction(args), expected, 'Got expected result');
    }

    return;
  });
});
