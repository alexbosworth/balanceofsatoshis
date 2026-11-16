const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {idForTransaction} = require('@alexbosworth/blockchain');
const {p2wshOutputScript} = require('goldengate');
const {pointFromScalar} = require('tiny-secp256k1');
const {swapScriptV2} = require('goldengate');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const signHtlcRefunds = require('./../../swaps/sign_htlc_refunds');

const bufferAsHex = buffer => buffer.toString('hex');
const clientKey = Buffer.alloc(32, 1);
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const serviceKey = Buffer.alloc(32, 2);
const later = 800144;
const sweepAddress = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const timeout = 800000;

const clientPublicKey = bufferAsHex(Buffer.from(pointFromScalar(clientKey)));
const hash = bufferAsHex(Buffer.alloc(32, 3));
const servicePublicKey = bufferAsHex(Buffer.from(pointFromScalar(serviceKey)));

// The HTLC that the service can move the deposit into
const {script} = swapScriptV2({
  hash,
  timeout,
  claim_public_key: servicePublicKey,
  refund_public_key: clientPublicKey,
});

// A fallback transaction paying to the HTLC and to change
const makeFallback = ({htlcScript, type}) => {
  const {transaction} = transactionFromComponents({
    inputs: [{id: hash, script: '', sequence: 0, vout: 0}],
    locktime: 0,
    outputs: [
      {script: '5120' + clientPublicKey.slice(2), tokens: 5000},
      {script: htlcScript || p2wshOutputScript({script}).output, tokens: 1e5},
    ],
    version: 2,
  });

  return {transaction, type, id: idForTransaction({transaction}).id};
};

// LND with the HTLC refund key, the refund signature is not checked here
const lnd = {
  signer: {
    signOutputRaw: ({sign_descs}, cbk) => cbk(null, {
      raw_sigs: sign_descs.map(() => Buffer.alloc(71, 1)),
    }),
  },
  wallet: {
    deriveKey: ({}, cbk) => cbk(null, {
      key_loc: {key_index: 0},
      raw_key_bytes: hexAsBuffer(clientPublicKey),
    }),
  },
};

// Summarize refunds as what they refund and how much
const summary = ({refunds}) => ({
  refunds: refunds.map(refund => {
    const {transaction} = refund;

    const tx = componentsOfTransaction({transaction});

    const [input] = tx.inputs;
    const [output] = tx.outputs;

    return {
      fee_rate: refund.fee_rate,
      height: refund.height,
      is_id: refund.id === idForTransaction({transaction}).id,
      locktime: tx.locktime,
      spending: `${input.id}:${input.vout}`,
      tokens: output.tokens,
      type: refund.type,
    };
  }),
});

const fallbacks = [
  makeFallback({type: 'standard'}),
  makeFallback({type: 'high'}),
];

const makeArgs = overrides => {
  const args = {
    fallbacks,
    hash,
    lnd,
    script,
    timeout,
    key_index: 0,
    network: 'btc',
    rates: [{fee_rate: 1, height: timeout}, {fee_rate: 2, height: later}],
    service_public_key: servicePublicKey,
    sweep_address: sweepAddress,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeExpected = overrides => {
  const [standard, high] = fallbacks;

  const expected = {
    refunds: [
      {
        fee_rate: 1,
        height: timeout,
        is_id: true,
        locktime: timeout,
        spending: `${standard.id}:1`,
        tokens: 99865,
        type: 'standard',
      },
      {
        fee_rate: 2,
        height: later,
        is_id: true,
        locktime: later,
        spending: `${standard.id}:1`,
        tokens: 99730,
        type: 'standard',
      },
      {
        fee_rate: 1,
        height: timeout,
        is_id: true,
        locktime: timeout,
        spending: `${high.id}:1`,
        tokens: 99865,
        type: 'high',
      },
      {
        fee_rate: 2,
        height: later,
        is_id: true,
        locktime: later,
        spending: `${high.id}:1`,
        tokens: 99730,
        type: 'high',
      },
    ],
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({fallbacks: []}),
    description: 'Fallbacks are expected',
    error: [400, 'ExpectedFallbacksToSignHtlcRefunds'],
  },
  {
    args: makeArgs({rates: undefined}),
    description: 'Fee rates are expected',
    error: [400, 'ExpectedFeeRatesToSignHtlcRefunds'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedAuthenticatedLndToSignHtlcRefunds'],
  },
  {
    args: makeArgs({script: undefined}),
    description: 'The HTLC script is expected',
    error: [400, 'ExpectedHtlcScriptToSignHtlcRefunds'],
  },
  {
    args: makeArgs({fallbacks: [{id: hash, transaction: '00', type: 'x'}]}),
    description: 'Fallback transactions are expected to decode',
    error: [503, 'FailedToDecodeSwapInFallbackTx'],
  },
  {
    args: makeArgs({
      fallbacks: [makeFallback({htlcScript: '0014' + hash.slice(24)})],
    }),
    description: 'Fallback transactions are expected to pay to the HTLC',
    error: [503, 'ExpectedHtlcOutputInSwapInFallbackTx'],
  },
  {
    args: makeArgs({network: undefined}),
    description: 'Errors signing refunds are passed back',
    error: [400, 'ExpectedKnownNetworkForSwapInFallbackRefund'],
  },
  {
    args: makeArgs({}),
    description: 'Every fallback HTLC is refunded at every fee rate',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({
      fallbacks: fallbacks.slice(0, 1),
      rates: [{fee_rate: 2, height: later}, {fee_rate: 1e4, height: later}],
    }),
    description: 'A fee rate that leaves only dust is skipped',
    expected: makeExpected({
      refunds: [{
        fee_rate: 2,
        height: later,
        is_id: true,
        locktime: later,
        spending: `${fallbacks[0].id}:1`,
        tokens: 99730,
        type: 'standard',
      }],
    }),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(signHtlcRefunds(args), error, 'Got expected error');
    } else {
      deepEqual(summary(await signHtlcRefunds(args)), expected, 'Got');
    }

    return;
  });
});
