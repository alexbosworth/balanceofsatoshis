const EventEmitter = require('events');
const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {compactIntAsNumber} = require('@alexbosworth/blockchain');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {numberAsCompactInt} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');
const {unsignedTxFromPsbt} = require('@alexbosworth/blockchain');

const {fundTransaction} = require('./../../chain');
const {getInfoResponse} = require('./../fixtures');

const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const addressScript = '0014e8df018c7e326cc253faac7e46cdc51e68542c42';
const bufferAsHex = buffer => buffer.toString('hex');
const changeScript = '0014' + '01'.repeat(20);
const encodeCount = number => numberAsCompactInt({number}).encoded;
const fee = 1000;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const lockId = Buffer.alloc(32, 2);
const maxSequence = 4294967295;
const otherAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const otherScript = '0014751e76e8199196d454941c45d1b3a323f1433bd6';
const psbtMapSeparator = Buffer.alloc(1);
const spendTxId = '00'.repeat(32);
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const testnetAddress = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const unknownTxId = '03'.repeat(32);
const utxoTokens = 100000;
const versionByteLength = 4;

const outpoint = `${spendTxId}:0`;
const psbtMagic = hexAsBuffer('70736274ff');
const psbtUnsignedTxKey = hexAsBuffer('0100');
const psbtWitnessUtxoKey = hexAsBuffer('0101');

// Decode the unsigned transaction of a PSBT, which can be without inputs
const decodeTemplate = ({psbt}) => {
  const start = psbtMagic.length + psbtUnsignedTxKey.length;

  const {bytes, number} = compactIntAsNumber({encoded: psbt, start});

  const tx = psbt.subarray(start + bytes, start + bytes + number);

  // Exit early when there are inputs, so the encoding is not ambiguous
  if (!!tx[versionByteLength]) {
    return componentsOfTransaction({transaction: bufferAsHex(tx)});
  }

  // Without inputs the encoding reads as SegWit, so read it with an input
  const withInput = Buffer.concat([
    tx.subarray(0, versionByteLength),
    encodeCount(1),
    Buffer.alloc(36),
    encodeCount(0),
    Buffer.alloc(4),
    tx.subarray(versionByteLength + 1),
  ]);

  const {outputs} = componentsOfTransaction({
    transaction: bufferAsHex(withInput),
  });

  return {outputs, inputs: []};
};

// The witness UTXO of an input, the wallet output that the input spends
const makeWitnessUtxo = ({}) => {
  const script = hexAsBuffer(changeScript);
  const value = Buffer.alloc(8);

  value.writeBigUInt64LE(BigInt(utxoTokens));

  return Buffer.concat([value, encodeCount(script.length), script]);
};

// Encode a PSBT of an unsigned transaction that spends wallet UTXOs
const makePsbt = ({transaction}) => {
  const tx = hexAsBuffer(transaction);
  const utxo = makeWitnessUtxo({});

  const {inputs, outputs} = componentsOfTransaction({transaction});

  const inputMaps = inputs.map(() => Buffer.concat([
    psbtWitnessUtxoKey,
    encodeCount(utxo.length),
    utxo,
    psbtMapSeparator,
  ]));

  return Buffer.concat([
    psbtMagic,
    psbtUnsignedTxKey,
    encodeCount(tx.length),
    tx,
    psbtMapSeparator,
    ...inputMaps,
    ...outputs.map(() => psbtMapSeparator),
  ]);
};

// Fund outputs like LND does, adding value left over after the fee to change
const fundTemplate = ({existing, inputs, outputs}) => {
  const spending = utxoTokens * inputs.length;

  const leftover = spending - sumOf(outputs.map(n => n.tokens)) - fee;

  // Without a change output, LND adds a change output when there is value
  const added = [{script: changeScript, tokens: leftover}].filter(n => {
    return existing === undefined && n.tokens > 0;
  });

  const funded = outputs.map((output, i) => ({
    script: output.script,
    tokens: i === existing ? output.tokens + leftover : output.tokens,
  }));

  const {transaction} = transactionFromComponents({
    inputs: inputs.map(input => ({
      id: input.id,
      script: '',
      sequence: maxSequence,
      vout: input.vout,
    })),
    locktime: 0,
    outputs: funded.concat(added),
    version: 2,
  });

  const changeIndex = !!added.length ? outputs.length : -1;

  return {
    transaction,
    change_output_index: existing === undefined ? changeIndex : existing,
    psbt: makePsbt({transaction}),
  };
};

// Make a subscription stream that emits data on the next tick
const makeStream = data => {
  const stream = new EventEmitter();

  stream.cancel = () => {};

  setImmediate(() => stream.emit('data', data));

  return stream;
};

const makeLnd = args => {
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
          raw_tx: hexAsBuffer(lastTx),
        },
      }),
    },
    default: {
      getInfo: ({}, cbk) => cbk(null, getInfoResponse),
    },
    wallet: {
      estimateFee: ({}, cbk) => {
        return cbk(null, {sat_per_kw: args.fee_rate || '1250'});
      },
      finalizePsbt: (req, cbk) => {
        const psbt = bufferAsHex(req.funded_psbt);

        lastTx = bufferAsHex(unsignedTxFromPsbt({psbt}).transaction);

        return cbk(null, {
          raw_final_tx: hexAsBuffer(lastTx),
          signed_psbt: req.funded_psbt,
        });
      },
      fundPsbt: (req, cbk) => {
        deepEqual(
          {sat_per_kw: req.sat_per_kw, sat_per_vbyte: req.sat_per_vbyte},
          args.rate || {sat_per_kw: 1250, sat_per_vbyte: undefined},
          'Got expected fee rate'
        );

        if (!!args.fund_error) {
          return cbk(args.fund_error);
        }

        const template = decodeTemplate({psbt: req.coin_select.psbt});

        // LND selects coins to spend when the template has no inputs
        const isSelecting = !template.inputs.length;

        const selected = [{id: args.tx_id || spendTxId, vout: 0}];

        const inputs = isSelecting ? selected : template.inputs;

        const funded = fundTemplate({
          inputs,
          existing: req.coin_select.existing_output_index,
          outputs: template.outputs,
        });

        // LND locks the coins that it selects
        const locks = selected.filter(() => isSelecting).map(input => ({
          expiration: '1',
          id: lockId,
          outpoint: {
            output_index: input.vout,
            txid_bytes: hexAsBuffer(input.id).reverse(),
          },
        }));

        return cbk(null, {
          change_output_index: funded.change_output_index,
          funded_psbt: funded.psbt,
          locked_utxos: locks,
        });
      },
      leaseOutput: ({outpoint}, cbk) => {
        // Exit early when locking the second output of a transaction fails
        if (!!args.is_locking_failing && !!outpoint.output_index) {
          return cbk({details: 'locked'});
        }

        return cbk(null, {expiration: '1'});
      },
      listUnspent: ({}, cbk) => cbk(null, {
        utxos: args.utxos || [{
          address,
          address_type: 'WITNESS_PUBKEY_HASH',
          amount_sat: String(utxoTokens),
          confirmations: '1',
          outpoint: {output_index: 0, txid_str: spendTxId},
          pk_script: changeScript,
        }],
      }),
      publishTransaction: ({}, cbk) => cbk(null, {}),
      releaseOutput: ({}, cbk) => cbk(args.unlock_error || null, {}),
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

// The signed transaction spending the wallet UTXO to outputs and change
const signedTx = ({outputs}) => {
  const inputs = [{id: spendTxId, vout: 0}];

  return fundTemplate({inputs, outputs}).transaction;
};

const makeExpected = overrides => {
  const expected = {
    fee_tokens_per_vbyte: '8.85',
    signed_transaction: signedTx({
      outputs: [{script: addressScript, tokens: 50000}],
    }),
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

// The expected result of spending the max amount to one address
const maxExpected = makeExpected({
  fee_tokens_per_vbyte: '12.20',
  signed_transaction: signedTx({
    outputs: [{script: addressScript, tokens: 99000}],
  }),
});

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
    args: makeArgs({fee_mtokens_per_vbyte: 1.5}),
    description: 'An integer precise fee rate is required',
    error: [400, 'ExpectedIntegerPreciseFeeRateToFundTransaction'],
  },
  {
    args: makeArgs({fee_mtokens_per_vbyte: 1500, fee_tokens_per_vbyte: 2}),
    description: 'Either a fee rate or a precise fee rate is used, not both',
    error: [400, 'ExpectedEitherFeeRateOrPreciseFeeRateNotBoth'],
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
    args: makeArgs({addresses: [testnetAddress]}),
    description: 'Addresses must be for the network of the node',
    error: [400, 'UnexpectedBech32AddressPrefixForNetwork'],
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
    args: makeArgs({is_selecting_utxos: true, lnd: makeLnd({utxos: []})}),
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
    args: makeArgs({lnd: makeLnd({tx_id: unknownTxId})}),
    description: 'The funded transaction must spend known UTXOs',
    error: [503, 'ExpectedSpendingKnownUtxosForFundedTx'],
  },
  {
    args: makeArgs({}),
    description: 'Fund a transaction',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({
      fee_tokens_per_vbyte: 3,
      is_dry_run: true,
      lnd: makeLnd({rate: {sat_per_kw: 750, sat_per_vbyte: undefined}}),
    }),
    description: 'Fund a transaction in a dry run with a fee rate',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({
      fee_mtokens_per_vbyte: 1500,
      lnd: makeLnd({rate: {sat_per_kw: 375, sat_per_vbyte: undefined}}),
    }),
    description: 'Fund a transaction with a precise fee rate',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        fee_rate: '253',
        rate: {sat_per_kw: 253, sat_per_vbyte: undefined},
      }),
    }),
    description: 'A fractional chain fee rate is used as it was estimated',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({amounts: ['max'], utxos: [outpoint]}),
    description: 'Fund a transaction spending the max amount',
    expected: maxExpected,
  },
  {
    args: makeArgs({
      amounts: ['max'],
      fee_tokens_per_vbyte: 3,
      lnd: makeLnd({rate: {sat_per_kw: 750, sat_per_vbyte: undefined}}),
      utxos: [outpoint],
    }),
    description: 'Fund a max amount transaction with a fee rate',
    expected: maxExpected,
  },
  {
    args: makeArgs({
      amounts: ['max'],
      fee_mtokens_per_vbyte: 1500,
      is_dry_run: true,
      lnd: makeLnd({rate: {sat_per_kw: 375, sat_per_vbyte: undefined}}),
      utxos: [outpoint],
    }),
    description: 'Fund a max amount transaction in a dry run, precise rate',
    expected: maxExpected,
  },
  {
    args: makeArgs({
      addresses: [address, otherAddress],
      amounts: ['max/2', 'max/2'],
      utxos: [outpoint],
    }),
    description: 'Fund a max amount split across addresses',
    expected: makeExpected({
      signed_transaction: signedTx({
        outputs: [
          {script: addressScript, tokens: 49500},
          {script: otherScript, tokens: 49500},
        ],
      }),
    }),
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
      lnd: makeLnd({fund_error: {details: 'insufficient'}}),
    }),
    description: 'Selecting UTXOs requires enough value to fund outputs',
    error: [
      503,
      'UnexpectedErrorCreatingFundedPsbt',
      {err: {details: 'insufficient'}},
    ],
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        fund_error: {details: 'insufficient'},
        unlock_error: {details: 'unlock'},
      }),
      utxos: [outpoint],
    }),
    description: 'A funding failure is passed back after unlocking UTXOs',
    error: [
      503,
      'UnexpectedErrorCreatingFundedPsbt',
      {err: {details: 'insufficient'}},
    ],
  },
  {
    args: makeArgs({
      lnd: makeLnd({is_locking_failing: true}),
      utxos: [outpoint, `${spendTxId}:1`],
    }),
    description: 'Locked UTXOs are unlocked when another UTXO fails to lock',
    error: [503, 'UnexpectedErrorLockingUtxo', {err: {details: 'locked'}}],
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
    expected: makeExpected({}),
  },
  {
    args: makeArgs({
      ask: makeAsk({checks: [{expected: true, input: [{value: outpoint}]}]}),
      amounts: ['max'],
      is_selecting_utxos: true,
    }),
    description: 'Fund a max amount transaction with selected UTXOs',
    expected: maxExpected,
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
