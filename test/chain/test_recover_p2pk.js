const {createHash} = require('node:crypto');
const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {encode} = require('bip66');
const {idForTransaction} = require('@alexbosworth/blockchain');
const {nonWitnessHashToSign} = require('@alexbosworth/blockchain');
const {outputScriptForAddress} = require('@alexbosworth/blockchain');
const {pointFromScalar} = require('tiny-secp256k1');
const {scriptElementsAsScript} = require('@alexbosworth/blockchain');
const {sign} = require('tiny-secp256k1');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const {recoverP2pk} = require('./../../chain');
const {getInfoResponse} = require('./../fixtures');

const emptyScript = '';
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const identityKey = Buffer.alloc(32, 1);
const inputSequence = 0;
const locktime = 0;
const maxSequence = 4294967295;
const nodeIdentityKeyFamily = 6;
const nodeIdentityKeyIndex = 0;
const OP_CHECKSIG = 172;
const otherKey = Buffer.alloc(32, 2);
const sha256 = n => createHash('sha256').update(n).digest();
const sigHashAll = 1;
const signBit = 0x80;
const sweepAddress = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const testnetSweepAddress = 'tb1qqszqgpqyqszqgpqyqszqgpqyqszqgpqy7ty85f';
const tokens = 100000;
const unknownId = Buffer.alloc(32).toString('hex');
const version = 1;

// Sweep fee: 10 sat/vbyte for 82 unsigned vbytes plus 73 for the signature
const fee = 1550;

const identityPublicKey = Buffer.from(pointFromScalar(identityKey, true));
const otherPublicKey = Buffer.from(pointFromScalar(otherKey, true));

// A pay to public key output script is the public key followed by a checksig
const p2pkScript = publicKey => {
  return scriptElementsAsScript({elements: [publicKey, OP_CHECKSIG]}).script;
};

// DER integers have no leading zeros, except to keep the sign bit positive
const derInteger = n => {
  const bytes = n.subarray(n.findIndex(byte => !!byte));

  if (!(bytes[0] & signBit)) {
    return bytes;
  }

  return Buffer.concat([Buffer.alloc(1), bytes]);
};

// LND returns signatures DER encoded, as a sequence of the R and S values
const derEncode = signature => {
  const r = derInteger(signature.subarray(0, 32));
  const s = derInteger(signature.subarray(32));

  return Buffer.from(encode(r, s));
};

// Make a transaction that pays to a public key output
const makeFundingTx = ({publicKey}) => {
  return transactionFromComponents({
    locktime,
    version,
    inputs: [{
      id: unknownId,
      script: emptyScript,
      sequence: maxSequence,
      vout: 0,
    }],
    outputs: [{tokens, script: p2pkScript(publicKey)}],
  }).transaction;
};

const fundingTx = makeFundingTx({publicKey: identityPublicKey});
const otherFundingTx = makeFundingTx({publicKey: otherPublicKey});

const fundingId = idForTransaction({transaction: fundingTx}).id;
const otherFundingId = idForTransaction({transaction: otherFundingTx}).id;

// Make the expected sweep of the funding output, signed by the identity key
const makeSweepTx = ({address, network}) => {
  const {script} = outputScriptForAddress({address, network});

  // The sweep transaction, serialized with a given input script
  const sweep = inputScript => transactionFromComponents({
    locktime,
    version,
    inputs: [{
      id: fundingId,
      script: inputScript,
      sequence: inputSequence,
      vout: 0,
    }],
    outputs: [{script, tokens: tokens - fee}],
  }).transaction;

  const {hash} = nonWitnessHashToSign({
    script: p2pkScript(identityPublicKey),
    sighash: sigHashAll,
    transaction: sweep(emptyScript),
    vin: 0,
  });

  const signature = Buffer.from(sign(hexAsBuffer(hash), identityKey));

  const sigHashType = Buffer.from([sigHashAll]);

  // A chain signature is the DER signature followed by the sighash type
  const elements = [Buffer.concat([derEncode(signature), sigHashType])];

  return sweep(scriptElementsAsScript({elements}).script);
};

const makeLnd = ({address, network}) => ({
  default: {
    getInfo: ({}, cbk) => cbk(null, {
      ...getInfoResponse,
      chains: [{chain: 'bitcoin', network: network || 'mainnet'}],
    }),
    newAddress: ({}, cbk) => cbk(null, {address: address || sweepAddress}),
  },
  signer: {
    signMessage: ({key_loc, msg}, cbk) => {
      // Only the node identity key is available to sign with
      if (key_loc.key_family !== nodeIdentityKeyFamily) {
        return cbk('UnexpectedKeyFamilyToSignMessage');
      }

      if (key_loc.key_index !== nodeIdentityKeyIndex) {
        return cbk('UnexpectedKeyIndexToSignMessage');
      }

      // The signer hashes the message once more before signing it
      const signature = Buffer.from(sign(sha256(msg), identityKey));

      return cbk(null, {signature: derEncode(signature)});
    },
  },
  wallet: {
    deriveKey: ({}, cbk) => cbk(null, {
      key_loc: {key_index: nodeIdentityKeyIndex},
      raw_key_bytes: identityPublicKey,
    }),
    estimateFee: ({}, cbk) => cbk(null, {sat_per_kw: '2500'}),
    publishTransaction: ({}, cbk) => cbk(null, {}),
  },
});

// Request function that returns the raw transaction hex
const makeRequest = ({tx}) => {
  return ({}, cbk) => cbk(null, null, tx || fundingTx);
};

const makeArgs = overrides => {
  const args = {
    id: fundingId,
    lnd: makeLnd({}),
    request: makeRequest({}),
    vout: 0,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({id: undefined}),
    description: 'A transaction id is expected',
    error: [400, 'ExpectedTxIdOfFundsSentToP2pkToRecoverFunds'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedAuthenticatedLndToRcoverP2pkFunds'],
  },
  {
    args: makeArgs({request: undefined}),
    description: 'A request function is expected',
    error: [400, 'ExpectedRequestFunctionToRecoverP2pkFunds'],
  },
  {
    args: makeArgs({vout: undefined}),
    description: 'A transaction output index is expected',
    error: [400, 'ExpectedTxVoutOfFundsSentToP2pkToRecoverFunds'],
  },
  {
    args: makeArgs({id: unknownId}),
    description: 'The raw transaction must match the transaction id',
    error: [503, 'ExpectedTransactionIdToMatchTxDataHashToRecover'],
  },
  {
    args: makeArgs({vout: 1}),
    description: 'The transaction must have an output at the vout index',
    error: [503, 'ExpectedOutputAtVoutIndexToRecoverP2pkFunds'],
  },
  {
    args: makeArgs({
      id: otherFundingId,
      request: makeRequest({tx: otherFundingTx}),
    }),
    description: 'The output must pay to the node identity key',
    error: [503, 'ExpectedOutputPayingToNodeIdentityPublicKey'],
  },
  {
    args: makeArgs({lnd: makeLnd({address: testnetSweepAddress})}),
    description: 'The recovery address must be for the node network',
    error: [
      503,
      'FailedToParseRecoveryAddress',
      {err: new Error('UnexpectedBech32AddressPrefixForNetwork')},
    ],
  },
  {
    args: makeArgs({
      lnd: (() => {
        const lnd = makeLnd({});

        lnd.signer.signMessage = ({}, cbk) => cbk('err');

        return lnd;
      })(),
    }),
    description: 'Errors signing the sweep are passed back',
    error: [503, 'UnexpectedErrorWhenSigningBytes', {err: 'err'}],
  },
  {
    args: makeArgs({
      lnd: (() => {
        const lnd = makeLnd({});

        lnd.wallet.publishTransaction = ({}, cbk) => {
          return cbk(null, {publish_error: 'err'});
        };

        return lnd;
      })(),
    }),
    description: 'Errors broadcasting the sweep are passed back',
    error: [
      503,
      'FailedToBroadcastRawTransaction',
      {res: {publish_error: 'err'}},
    ],
  },
  {
    args: makeArgs({}),
    description: 'Funds sent to the node identity key are recovered',
    expected: {
      recovering: tokens,
      recovering_to: sweepAddress,
      transaction_id: idForTransaction({
        transaction: makeSweepTx({address: sweepAddress, network: 'btc'}),
      }).id,
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({address: testnetSweepAddress, network: 'testnet'}),
    }),
    // This sweep's signature has a sign-padded R value in its DER encoding
    description: 'Funds sent to the identity key are recovered on testnet',
    expected: {
      recovering: tokens,
      recovering_to: testnetSweepAddress,
      transaction_id: idForTransaction({
        transaction: makeSweepTx({
          address: testnetSweepAddress,
          network: 'btctestnet',
        }),
      }).id,
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(recoverP2pk(args), error, 'Got expected error');
    } else {
      deepEqual(await recoverP2pk(args), expected, 'Got expected result');
    }

    return;
  });
});
