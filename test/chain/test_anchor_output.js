const {createHash} = require('node:crypto');
const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const {p2wshOutputScript} = require('@alexbosworth/blockchain');
const {scriptElementsAsScript} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const method = require('./../../chain/anchor_output');

const anchorTokens = 330;
const balanceScript = `0020${'02'.repeat(32)}`;
const closeTxId = Buffer.alloc(32, 1).toString('hex');
const key1 = Buffer.from(`02${'11'.repeat(32)}`, 'hex');
const key2 = Buffer.from(`03${'22'.repeat(32)}`, 'hex');
const sha256 = preimage => createHash('sha256').update(preimage).digest();
const signature = Buffer.alloc(71, 3).toString('hex');

// Anchor outputs pay to the funding keys with a 16 block CSV escape
const anchorScript = key => {
  const {script} = scriptElementsAsScript({
    elements: [key, 172, 115, 100, 96, 178, 104],
  });

  const hash = sha256(Buffer.from(script, 'hex'));

  return p2wshOutputScript({hash}).script.toString('hex');
};

// The funding output is a 2 of 2 multisig of the funding keys
const fundingScript = scriptElementsAsScript({
  elements: [82, key1, key2, 82, 174],
}).script;

const fundingWitness = ['', signature, signature, fundingScript];

const makeTx = ({outputs, witness}) => {
  return transactionFromComponents({
    outputs,
    inputs: [{
      id: Buffer.alloc(32).toString('hex'),
      script: '',
      vout: 0,
      witness: witness || fundingWitness,
    }],
    locktime: 0,
    version: 2,
  }).transaction;
};

// A commitment with a balance output and both anchors
const twoAnchorsTx = makeTx({
  outputs: [
    {script: balanceScript, tokens: 90000},
    {script: anchorScript(key1), tokens: anchorTokens},
    {script: anchorScript(key2), tokens: anchorTokens},
  ],
});

// A commitment with only the peer's balance output and a single anchor
const oneAnchorTx = makeTx({
  outputs: [
    {script: balanceScript, tokens: 90000},
    {script: anchorScript(key2), tokens: anchorTokens},
  ],
});

// A legacy commitment where the balance is at the 330 dust limit
const legacyTx = makeTx({
  outputs: [
    {script: `0020${'04'.repeat(32)}`, tokens: 90000},
    {script: balanceScript, tokens: anchorTokens},
  ],
});

// A taproot channel spends the funding output with a key spend witness
const keySpendTx = makeTx({
  outputs: [{script: anchorScript(key1), tokens: anchorTokens}],
  witness: [Buffer.alloc(64, 5).toString('hex')],
});

// A close that spends the funding output with a script that is not multisig
const otherScriptTx = makeTx({
  outputs: [{script: anchorScript(key1), tokens: anchorTokens}],
  witness: ['', signature, anchorScript(key1)],
});

// A close with a malformed witness script
const badScriptTx = makeTx({
  outputs: [{script: anchorScript(key1), tokens: anchorTokens}],
  witness: ['', signature, 'ff'],
});

// A close with a multisig witness script that has no keys in it
const badKeysTx = makeTx({
  outputs: [{script: anchorScript(key1), tokens: anchorTokens}],
  witness: [
    '',
    signature,
    scriptElementsAsScript({elements: [82, 81, 81, 82, 174]}).script,
  ],
});

// A close with a multisig witness script that is not a 2 of 2
const oneOfTwoTx = makeTx({
  outputs: [{script: anchorScript(key1), tokens: anchorTokens}],
  witness: [
    '',
    signature,
    scriptElementsAsScript({elements: [81, key1, key2, 82, 174]}).script,
  ],
});

// A close with a witness script that is not a checkmultisig
const noMultisigTx = makeTx({
  outputs: [{script: anchorScript(key1), tokens: anchorTokens}],
  witness: [
    '',
    signature,
    scriptElementsAsScript({elements: [82, key1, key2, 82, 172]}).script,
  ],
});

// A close that spends the funding output without witness data
const noWitnessTx = makeTx({
  outputs: [{script: anchorScript(key1), tokens: anchorTokens}],
  witness: [],
});

const makeArgs = overrides => {
  const args = {
    close_payments: [],
    close_transaction_id: closeTxId,
    is_cooperative_close: false,
    transaction: twoAnchorsTx,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({anchor_vout: 2, transaction: undefined}),
    description: 'An anchor output reported by LND is used',
    expected: {vout: 2},
  },
  {
    args: makeArgs({is_cooperative_close: true}),
    description: 'A cooperative close has no anchor outputs',
    expected: {},
  },
  {
    args: makeArgs({transaction: undefined}),
    description: 'The anchor is not found without the close transaction',
    expected: {},
  },
  {
    args: makeArgs({transaction: keySpendTx}),
    description: 'Anchors are not derived from a key spend of the funds',
    expected: {},
  },
  {
    args: makeArgs({transaction: otherScriptTx}),
    description: 'Anchors are not derived from a non multisig funding script',
    expected: {},
  },
  {
    args: makeArgs({transaction: badScriptTx}),
    description: 'Anchors are not derived from a malformed funding script',
    expected: {},
  },
  {
    args: makeArgs({transaction: badKeysTx}),
    description: 'Anchors are not derived from a multisig without keys',
    expected: {},
  },
  {
    args: makeArgs({transaction: oneOfTwoTx}),
    description: 'Anchors are not derived from a 1 of 2 multisig',
    expected: {},
  },
  {
    args: makeArgs({transaction: noMultisigTx}),
    description: 'Anchors are not derived from a script without checkmultisig',
    expected: {},
  },
  {
    args: makeArgs({transaction: noWitnessTx}),
    description: 'Anchors are not derived without witness data',
    expected: {},
  },
  {
    args: makeArgs({transaction: legacyTx}),
    description: 'A 330 token balance at the dust limit is not an anchor',
    expected: {},
  },
  {
    args: makeArgs({}),
    description: 'One of two anchors is ours',
    expected: {vout: 1},
  },
  {
    args: makeArgs({close_balance_vout: 1}),
    description: 'The balance output is never taken to be an anchor',
    expected: {},
  },
  {
    args: makeArgs({
      close_payments: [{transaction_id: closeTxId, transaction_vout: 1}],
    }),
    description: 'An HTLC output is never taken to be an anchor',
    expected: {vout: 2},
  },
  {
    args: makeArgs({transaction: oneAnchorTx}),
    description: 'A single anchor is not ours without outputs to protect',
    expected: {},
  },
  {
    args: makeArgs({
      close_balance_spent_by: Buffer.alloc(32, 1).toString('hex'),
      transaction: oneAnchorTx,
    }),
    description: 'A single anchor is ours when the balance was swept',
    expected: {vout: 1},
  },
  {
    args: makeArgs({
      close_payments: [{transaction_id: closeTxId, transaction_vout: 0}],
      transaction: oneAnchorTx,
    }),
    description: 'A single anchor is ours when there were HTLCs',
    expected: {vout: 1},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected anchor output');

    return;
  });
});
