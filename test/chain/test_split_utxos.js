const {deepEqual} = require('node:assert').strict;
const {promisify} = require('node:util');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {idForTransaction} = require('@alexbosworth/blockchain');
const {numberAsCompactInt} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');
const {unsignedTxFromPsbt} = require('@alexbosworth/blockchain');

const {splitUtxos} = require('./../../chain');

const asOutpoint = n => `${n.txid_str}:${n.output_index}`;
const changeScript = `0014${'02'.repeat(20)}`;
const feeRate = 5;
const lockId = Buffer.alloc(32, 2);
const maxSequence = 4294967295;
const outputScript = `0014${'01'.repeat(20)}`;
const psbtMagic = Buffer.from('70736274ff', 'hex');
const psbtMapSeparator = Buffer.alloc(1);
const psbtUnsignedTxKey = Buffer.from('0100', 'hex');
const size = 1e5;
const splitFee = 2230;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const txId = Buffer.alloc(32).toString('hex');

const split = promisify(splitUtxos);

const makeUtxo = ({confirmations, tokens, vout}) => ({
  address: 'address',
  address_type: 'WITNESS_PUBKEY_HASH',
  amount_sat: String(tokens),
  confirmations: String(confirmations),
  outpoint: {output_index: vout, txid_str: txId},
  pk_script: `0014${'00'.repeat(20)}`,
});

// Two UTXOs are large enough, but only one large one is confirmed
const utxos = [
  makeUtxo({confirmations: 1, tokens: 200000, vout: 0}),
  makeUtxo({confirmations: 0, tokens: 150000, vout: 1}),
  makeUtxo({confirmations: 1, tokens: 50000, vout: 2}),
];

// Make an unsigned PSBT spending inputs to outputs and change, minus the fee
const makePsbt = ({fee, inputs, outputs}) => {
  const spending = inputs.map(input => {
    const outpoint = `${input.txid_str}:${input.output_index}`;

    const utxo = utxos.find(n => {
      return `${n.outpoint.txid_str}:${n.outpoint.output_index}` === outpoint;
    });

    return Number(utxo.amount_sat);
  });

  const funding = Object.keys(outputs).map(address => ({
    script: outputScript,
    tokens: Number(outputs[address]),
  }));

  const change = sumOf(spending) - sumOf(funding.map(n => n.tokens)) - fee;

  const changeOutputs = [{script: changeScript, tokens: change}].filter(n => {
    return n.tokens > 0;
  });

  const {transaction} = transactionFromComponents({
    inputs: inputs.map(input => ({
      id: input.txid_str,
      script: '',
      sequence: maxSequence,
      vout: input.output_index,
    })),
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
    ...inputs.map(() => psbtMapSeparator),
    ...funding.concat(changeOutputs).map(() => psbtMapSeparator),
  ]);

  return {
    psbt,
    change_output_index: !!changeOutputs.length ? funding.length : -1,
  };
};

// The split spends both confirmed utxos to an output and change
const splitPsbt = makePsbt({
  fee: splitFee,
  inputs: [
    {output_index: 0, txid_str: txId},
    {output_index: 2, txid_str: txId},
  ],
  outputs: {address1: String(size)},
});

const splitTx = unsignedTxFromPsbt({psbt: splitPsbt.psbt.toString('hex')});

const splitTxId = idForTransaction({
  transaction: splitTx.transaction.toString('hex'),
}).id;

const makeLnd = overrides => {
  const calls = {funded: [], published: [], released: []};

  let addressIndex = 0;

  const listUnspent = ({}, cbk) => cbk(null, {utxos});

  const lnd = {
    default: {
      listUnspent,
      newAddress: ({}, cbk) => {
        return cbk(null, {address: `address${++addressIndex}`});
      },
    },
    wallet: {
      listUnspent,
      estimateFee: ({}, cbk) => cbk(null, {sat_per_kw: '2500'}),
      finalizePsbt: ({funded_psbt}, cbk) => {
        const psbt = funded_psbt.toString('hex');

        const {transaction} = unsignedTxFromPsbt({psbt});

        return cbk(null, {
          raw_final_tx: transaction,
          signed_psbt: funded_psbt,
        });
      },
      fundPsbt: ({raw, sat_per_vbyte}, cbk) => {
        const inputs = raw.inputs.map(input => ({
          output_index: input.output_index,
          txid_str: Buffer.from(input.txid_bytes).reverse().toString('hex'),
        }));

        calls.funded.push({
          inputs: inputs.map(n => `${n.txid_str}:${n.output_index}`),
          outputs: raw.outputs,
          sat_per_vbyte,
        });

        const funded = makePsbt({
          inputs,
          fee: overrides.fee || splitFee,
          outputs: raw.outputs,
        });

        return cbk(null, {
          change_output_index: funded.change_output_index,
          funded_psbt: funded.psbt,
          locked_utxos: raw.inputs.map(input => ({
            expiration: '1',
            id: lockId,
            outpoint: input,
          })),
        });
      },
      publishTransaction: ({tx_hex}, cbk) => {
        const transaction = tx_hex.toString('hex');

        calls.published.push(idForTransaction({transaction}).id);

        return cbk(null, {});
      },
      releaseOutput: ({outpoint}, cbk) => {
        calls.released.push(asOutpoint(outpoint));

        return cbk(null, {});
      },
    },
  };

  // Replace methods with overrides
  Object.keys(overrides.methods || {}).forEach(type => {
    Object.keys(overrides.methods[type]).forEach(method => {
      lnd[type][method] = overrides.methods[type][method];
    });
  });

  return {calls, lnd};
};

const makeArgs = overrides => {
  const args = {size, count: 3};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const fail = ({}, cbk) => cbk('err');

const tests = [
  {
    args: makeArgs({count: undefined}),
    description: 'A count of utxos is required',
    error: [400, 'ExpectedSplitUtxosCountNumber'],
  },
  {
    args: makeArgs({}),
    description: 'LND is required',
    error: [400, 'ExpectedAuthenticatedLndToSplitUtxos'],
    lnd: {is_missing: true},
  },
  {
    args: makeArgs({size: undefined}),
    description: 'A utxo size is required',
    error: [400, 'ExpectedSizeOfUtxosToSplitTo'],
  },
  {
    args: makeArgs({size: size - 1}),
    description: 'A utxo size above the minimum is required',
    error: [400, 'ExpectedSizeOfUtxosToSplitTo'],
  },
  {
    args: makeArgs({}),
    description: 'Errors getting utxos are passed back',
    error: [503, 'UnexpectedErrorGettingUnspentTxOutputs', {err: 'err'}],
    lnd: {
      methods: {default: {listUnspent: fail}, wallet: {listUnspent: fail}},
    },
  },
  {
    args: makeArgs({}),
    description: 'Errors getting the chain fee rate are passed back',
    error: [503, 'UnexpectedErrorGettingFeeFromLnd', {err: 'err'}],
    lnd: {methods: {wallet: {estimateFee: fail}}},
  },
  {
    args: makeArgs({count: 1, is_dry_run: true}),
    description: 'No outputs are needed when there are enough utxos',
    expected: {needed_outputs: 0, sent_to: [], transaction_id: undefined},
  },
  {
    args: makeArgs({count: 2, is_dry_run: true}),
    description: 'No outputs are needed when there are exactly enough utxos',
    expected: {needed_outputs: 0, sent_to: [], transaction_id: undefined},
  },
  {
    args: makeArgs({count: 1}),
    description: 'Nothing is sent when there are more than enough utxos',
    expected: {needed_outputs: 0, sent_to: [], transaction_id: undefined},
    funded: [],
  },
  {
    args: makeArgs({count: 2}),
    description: 'Nothing is sent when there are exactly enough utxos',
    expected: {needed_outputs: 0, sent_to: [], transaction_id: undefined},
    funded: [],
  },
  {
    args: makeArgs({is_dry_run: true}),
    description: 'A dry run returns the count of outputs needed',
    expected: {needed_outputs: 1, sent_to: [], transaction_id: undefined},
    funded: [],
  },
  {
    args: makeArgs({}),
    description: 'A spent counted utxo is replaced by change of the split',
    expected: {
      needed_outputs: 1,
      sent_to: ['address1'],
      transaction_id: splitTxId,
    },
    funded: [{
      inputs: [`${txId}:0`, `${txId}:2`],
      outputs: {address1: String(size)},
      sat_per_vbyte: 10,
    }],
    published: [splitTxId],
    released: [],
  },
  {
    args: makeArgs({tokens_per_vbyte: feeRate}),
    description: 'Utxos are split with a specified fee rate',
    expected: {
      needed_outputs: 1,
      sent_to: ['address1'],
      transaction_id: splitTxId,
    },
    funded: [{
      inputs: [`${txId}:0`, `${txId}:2`],
      outputs: {address1: String(size)},
      sat_per_vbyte: feeRate,
    }],
    lnd: {methods: {wallet: {estimateFee: fail}}},
    published: [splitTxId],
  },
  {
    args: makeArgs({}),
    description: 'An estimated fee rate is rounded up',
    expected: {
      needed_outputs: 1,
      sent_to: ['address1'],
      transaction_id: splitTxId,
    },
    funded: [{
      inputs: [`${txId}:0`, `${txId}:2`],
      outputs: {address1: String(size)},
      sat_per_vbyte: 11,
    }],
    lnd: {
      methods: {
        wallet: {estimateFee: ({}, cbk) => cbk(null, {sat_per_kw: '2600'})},
      },
    },
    published: [splitTxId],
  },
  {
    args: makeArgs({count: 2, is_confirmed: true}),
    description: 'Unconfirmed utxos are not counted when confirmed only',
    expected: {
      needed_outputs: 1,
      sent_to: ['address1'],
      transaction_id: splitTxId,
    },
    funded: [{
      inputs: [`${txId}:0`, `${txId}:2`],
      outputs: {address1: String(size)},
      sat_per_vbyte: 10,
    }],
    published: [splitTxId],
  },
  {
    args: makeArgs({is_confirmed: true, is_dry_run: true}),
    description: 'Confirmed funds have to support a confirmed only count',
    error: [400, 'InsufficientBalanceToSplitUtxos'],
  },
  {
    args: makeArgs({count: 4, is_dry_run: true}),
    description: 'A dry run is rejected when funds cannot support the count',
    error: [400, 'InsufficientBalanceToSplitUtxos'],
  },
  {
    args: makeArgs({count: 4}),
    description: 'A split is rejected when funds cannot support the count',
    error: [400, 'InsufficientBalanceToSplitUtxos'],
    funded: [],
    published: [],
  },
  {
    args: makeArgs({}),
    description: 'Errors creating addresses are passed back',
    error: [503, 'UnexpectedErrorCreatingAddress', {err: 'err'}],
    funded: [],
    lnd: {methods: {default: {newAddress: fail}}},
  },
  {
    args: makeArgs({}),
    description: 'Errors funding the split are passed back',
    error: [503, 'UnexpectedErrorFundingTransaction', {err: 'err'}],
    lnd: {methods: {wallet: {fundPsbt: fail}}},
    released: [],
  },
  {
    args: makeArgs({}),
    description: 'A funded split that does not reach the count is released',
    error: [503, 'ExpectedFundedSplitToReachCountOfUtxos'],
    lnd: {fee: 60000},
    published: [],
    released: [`${txId}:0`, `${txId}:2`],
  },
  {
    args: makeArgs({}),
    description: 'Errors signing the split are passed back',
    error: [503, 'UnexpectedErrorSigningPsbt', {err: 'err'}],
    lnd: {methods: {wallet: {finalizePsbt: fail}}},
    published: [],
    released: [`${txId}:0`, `${txId}:2`],
  },
  {
    args: makeArgs({}),
    description: 'Errors broadcasting the split are passed back',
    error: [503, 'UnexpectedErrBroadcastingRawTx', {err: 'err'}],
    lnd: {methods: {wallet: {publishTransaction: fail}}},
    released: [`${txId}:0`, `${txId}:2`],
  },
  {
    args: makeArgs({}),
    description: 'Errors releasing inputs do not hide the split error',
    error: [503, 'UnexpectedErrBroadcastingRawTx', {err: 'err'}],
    lnd: {
      methods: {wallet: {publishTransaction: fail, releaseOutput: fail}},
    },
  },
];

tests.forEach(({args, description, error, expected, lnd, ...calls}) => {
  return test(description, async () => {
    const mock = makeLnd(lnd || {});

    args.lnd = !!lnd && !!lnd.is_missing ? undefined : mock.lnd;

    if (!!error) {
      await rejects(split(args), error, 'Got expected error');
    } else {
      deepEqual(await split(args), expected, 'Got expected result');
    }

    // Check the calls made to fund, publish and release the split
    Object.keys(calls).forEach(type => {
      deepEqual(mock.calls[type], calls[type], `Got expected ${type} calls`);
    });

    return;
  });
});
