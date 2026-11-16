const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {idForTransaction} = require('@alexbosworth/blockchain');
const {pointFromScalar} = require('tiny-secp256k1');
const {signSchnorr} = require('tiny-secp256k1');
const {v1HashToSign} = require('p2tr');

const signDepositRefunds = require('./../../swaps/sign_deposit_refunds');

const bufferAsHex = buffer => buffer.toString('hex');
const clientKey = Buffer.alloc(32, 1);
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const serviceKey = Buffer.alloc(32, 2);
const sweepAddress = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const clientPublicKey = Buffer.from(pointFromScalar(clientKey, true));
const servicePublicKey = Buffer.from(pointFromScalar(serviceKey, true));

// LND that signs taproot script spends with the client key
const lnd = {
  signer: {
    signOutputRaw: ({prev_outputs, raw_tx_bytes, sign_descs}, cbk) => {
      const spends = prev_outputs.map(output => ({
        script: bufferAsHex(output.pk_script),
        tokens: Number(output.value),
      }));

      return cbk(null, {
        raw_sigs: sign_descs.map(desc => {
          const {hash} = v1HashToSign({
            spends,
            leaf: {script: bufferAsHex(desc.witness_script)},
            sighash: desc.sighash,
            transaction: bufferAsHex(raw_tx_bytes),
            vin: desc.input_index,
          });

          return Buffer.from(signSchnorr(hexAsBuffer(hash), clientKey));
        }),
      });
    },
  },
  wallet: {
    deriveKey: ({}, cbk) => cbk(null, {
      key_loc: {key_index: 0},
      raw_key_bytes: clientPublicKey,
    }),
  },
};

// Summarize refunds as their fee rates and refunded amounts
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
      sequence: input.sequence,
      tokens: output.tokens,
    };
  }),
});

const makeArgs = overrides => {
  const args = {
    lnd,
    expiry: 100,
    key_index: 0,
    network: 'btc',
    rates: [{fee_rate: 1, height: 800000}, {fee_rate: 2, height: 800144}],
    service_public_key: bufferAsHex(servicePublicKey),
    sweep_address: sweepAddress,
    utxos: [{
      tokens: 100000,
      transaction_id: bufferAsHex(Buffer.alloc(32)),
      transaction_vout: 0,
    }],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const makeExpected = overrides => {
  const expected = {
    refunds: [
      {
        fee_rate: 1,
        height: 800000,
        is_id: true,
        locktime: 800000,
        sequence: 100,
        tokens: 99883,
      },
      {
        fee_rate: 2,
        height: 800144,
        is_id: true,
        locktime: 800144,
        sequence: 100,
        tokens: 99766,
      },
    ],
  };

  Object.keys(overrides).forEach(k => expected[k] = overrides[k]);

  return expected;
};

const tests = [
  {
    args: makeArgs({rates: []}),
    description: 'Fee rates are expected',
    error: [400, 'ExpectedFeeRatesToSignDepositRefunds'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedAuthenticatedLndToSignDepositRefunds'],
  },
  {
    args: makeArgs({network: undefined}),
    description: 'Errors signing refunds are passed back',
    error: [400, 'ExpectedKnownNetworkForSharedUtxosRefund'],
  },
  {
    args: makeArgs({}),
    description: 'A refund is signed at every fee rate',
    expected: makeExpected({}),
  },
  {
    args: makeArgs({
      rates: [{fee_rate: 1, height: 800000}, {fee_rate: 1000, height: 800144}],
    }),
    description: 'A fee rate that leaves only dust is skipped',
    expected: makeExpected({
      refunds: [{
        fee_rate: 1,
        height: 800000,
        is_id: true,
        locktime: 800000,
        sequence: 100,
        tokens: 99883,
      }],
    }),
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(signDepositRefunds(args), error, 'Got expected error');
    } else {
      deepEqual(summary(await signDepositRefunds(args)), expected, 'Got');
    }

    return;
  });
});
