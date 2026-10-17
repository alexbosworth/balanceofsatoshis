const {createHash} = require('node:crypto');
const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('node:events');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {idForTransaction} = require('@alexbosworth/blockchain');
const {numberAsCompactInt} = require('@alexbosworth/blockchain');
const {p2wshOutputScript} = require('@alexbosworth/blockchain');
const {scriptElementsAsScript} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const {getChannelCloses} = require('./../../chain');
const {getNodeInfoResponse} = require('./../fixtures');
const {pendingChannelsResponse} = require('./../fixtures');

const anchorFundingTxId = Buffer.alloc(32, 16).toString('hex');
const anchorSweepTxId = Buffer.alloc(32, 10).toString('hex');
const blockHeaderByteLength = 80;
const capacity = 100000;
const coopFundingTxId = Buffer.alloc(32, 1).toString('hex');
const currentHeight = 1000;
const emptyTxId = Buffer.alloc(32).toString('hex');
const forceFundingTxId = Buffer.alloc(32, 2).toString('hex');
const htlcSweepTxId = Buffer.alloc(32, 11).toString('hex');
const otherFundingTxId = Buffer.alloc(32, 17).toString('hex');
const htlcFundingTxId = Buffer.alloc(32, 18).toString('hex');
const secondLevelTxId = Buffer.alloc(32, 12).toString('hex');
const peerKey = `03${'01'.repeat(32)}`;
const signature = Buffer.alloc(71, 3).toString('hex');
const simpleFundingTxId = Buffer.alloc(32, 13).toString('hex');
const sweepFee = 300;

const idOf = transaction => idForTransaction({transaction}).id;
const sha256 = preimage => createHash('sha256').update(preimage).digest();

// Funding keys of the anchor channel
const fundingKey1 = Buffer.from(`02${'11'.repeat(32)}`, 'hex');
const fundingKey2 = Buffer.from(`03${'22'.repeat(32)}`, 'hex');

// Anchor outputs pay to a funding key with a 16 block CSV escape
const anchorScript = key => {
  const {script} = scriptElementsAsScript({
    elements: [key, 172, 115, 100, 96, 178, 104],
  });

  const hash = sha256(Buffer.from(script, 'hex'));

  return p2wshOutputScript({hash}).script.toString('hex');
};

// The funding output spend witness has the 2 of 2 multisig funding script
const fundingWitness = [
  '',
  signature,
  signature,
  scriptElementsAsScript({
    elements: [82, fundingKey1, fundingKey2, 82, 174],
  }).script,
];

// Make a hex encoded block out of raw transactions
const makeBlock = txs => Buffer.concat([
  Buffer.alloc(blockHeaderByteLength),
  numberAsCompactInt({number: txs.length}).encoded,
  ...txs.map(tx => Buffer.from(tx, 'hex')),
]).toString('hex');

// Make a hex encoded segwit transaction
const makeTx = ({inputs, outputs}) => {
  return transactionFromComponents({
    outputs,
    inputs: inputs.map(input => ({
      id: input.id,
      script: '',
      sequence: input.sequence || 0,
      vout: input.vout,
      witness: input.witness || [signature, `02${'04'.repeat(32)}`],
    })),
    locktime: 0,
    version: 2,
  }).transaction;
};

// The cooperative close pays out all but 1,000 of the channel capacity
const coopTx = makeTx({
  inputs: [{id: coopFundingTxId, vout: 0}],
  outputs: [
    {script: `0014${'05'.repeat(20)}`, tokens: 60000},
    {script: `0014${'06'.repeat(20)}`, tokens: 39000},
  ],
});

const coopTxId = idOf(coopTx);

// A simple cooperative close signals RBF on the funds spend
const simpleCoopTx = makeTx({
  inputs: [{id: simpleFundingTxId, sequence: 0xfffffffd, vout: 0}],
  outputs: [
    {script: `0014${'05'.repeat(20)}`, tokens: 60000},
    {script: `0014${'06'.repeat(20)}`, tokens: 39000},
  ],
});

const simpleCoopTxId = idOf(simpleCoopTx);

// The force close commitment pays out all but 2,000 of the channel capacity
const commitTx = makeTx({
  inputs: [{id: forceFundingTxId, vout: 1}],
  outputs: [{script: `0014${'07'.repeat(20)}`, tokens: 98000}],
});

const commitTxId = idOf(commitTx);

// An anchor channel commitment pays out a balance, an HTLC and two anchors
const anchorCommitTx = makeTx({
  inputs: [{id: anchorFundingTxId, vout: 0, witness: fundingWitness}],
  outputs: [
    {script: `0020${'11'.repeat(32)}`, tokens: 92340},
    {script: `0020${'12'.repeat(32)}`, tokens: 5000},
    {script: anchorScript(fundingKey1), tokens: 330},
    {script: anchorScript(fundingKey2), tokens: 330},
  ],
});

const anchorCommitTxId = idOf(anchorCommitTx);

// A wallet transaction with a 10,000 output used to fund the anchor sweep
const feeFundingTx = makeTx({
  inputs: [{id: Buffer.alloc(32, 15).toString('hex'), vout: 0}],
  outputs: [{script: `0014${'15'.repeat(20)}`, tokens: 10000}],
});

const feeFundingTxId = idOf(feeFundingTx);

// The anchor channel balance sweep pays a 500 fee
const balanceSweepTx = makeTx({
  inputs: [{id: anchorCommitTxId, vout: 0}],
  outputs: [{script: `0014${'16'.repeat(20)}`, tokens: 91840}],
});

const balanceSweepTxId = idOf(balanceSweepTx);

// The anchor sweep is funded by the wallet output and pays a 500 fee
const anchorSweepTx = makeTx({
  inputs: [{id: anchorCommitTxId, vout: 2}, {id: feeFundingTxId, vout: 0}],
  outputs: [{script: `0014${'17'.repeat(20)}`, tokens: 9830}],
});

const anchorCpfpTxId = idOf(anchorSweepTx);

// The timed out HTLC sweep pays a 300 fee
const htlcTimeoutTx = makeTx({
  inputs: [{id: anchorCommitTxId, vout: 1}],
  outputs: [{script: `0014${'18'.repeat(20)}`, tokens: 4700}],
});

const htlcTimeoutTxId = idOf(htlcTimeoutTx);

// Another channel's commitment with a 92,340 balance output
const otherCommitTx = makeTx({
  inputs: [{id: otherFundingTxId, vout: 0}],
  outputs: [{script: `0020${'19'.repeat(32)}`, tokens: 92340}],
});

const otherCommitTxId = idOf(otherCommitTx);

// A sweep shared between two channels with equal inputs pays a 1,000 fee
const sharedSweepTx = makeTx({
  inputs: [{id: anchorCommitTxId, vout: 0}, {id: otherCommitTxId, vout: 0}],
  outputs: [{script: `0014${'1a'.repeat(20)}`, tokens: 183680}],
});

const sharedSweepTxId = idOf(sharedSweepTx);

// Another channel's commitment with an HTLC output and no anchors
const htlcCommitTx = makeTx({
  inputs: [{id: htlcFundingTxId, vout: 0}],
  outputs: [
    {script: `0020${'1b'.repeat(32)}`, tokens: 92340},
    {script: `0020${'1c'.repeat(32)}`, tokens: 5000},
  ],
});

const htlcCommitTxId = idOf(htlcCommitTx);

// A second level tx for HTLCs of two channels pays a 400 fee
const sharedSecondLevelTx = makeTx({
  inputs: [{id: anchorCommitTxId, vout: 1}, {id: htlcCommitTxId, vout: 1}],
  outputs: [
    {script: `0020${'1d'.repeat(32)}`, tokens: 4800},
    {script: `0020${'1e'.repeat(32)}`, tokens: 4800},
  ],
});

const sharedSecondLevelTxId = idOf(sharedSecondLevelTx);

// A sweep of both second level outputs pays a 200 fee
const sharedSecondStageTx = makeTx({
  inputs: [
    {id: sharedSecondLevelTxId, vout: 0},
    {id: sharedSecondLevelTxId, vout: 1},
  ],
  outputs: [{script: `0014${'1f'.repeat(20)}`, tokens: 9400}],
});

const sharedSecondStageTxId = idOf(sharedSecondStageTx);

// The sweep transaction spends the commitment balance output
const sweepTx = makeTx({
  inputs: [{id: commitTxId, vout: 0}],
  outputs: [{script: `0014${'08'.repeat(20)}`, tokens: 98000 - sweepFee}],
});

const sweepTxId = idOf(sweepTx);

// A funding tx in the wallet for a close tx that is not in the wallet
const lookupFundingTx = makeTx({
  inputs: [{id: Buffer.alloc(32, 14).toString('hex'), vout: 0}],
  outputs: [{script: `0020${'0e'.repeat(32)}`, tokens: capacity}],
});

const lookupFundingTxId = idOf(lookupFundingTx);

// The close tx pays out to addresses that are outside of the wallet
const lookupCloseTx = makeTx({
  inputs: [{id: lookupFundingTxId, vout: 0}],
  outputs: [
    {script: `0014${'0f'.repeat(20)}`, tokens: 60000},
    {script: `0014${'10'.repeat(20)}`, tokens: 39000},
  ],
});

const lookupCloseTxId = idOf(lookupCloseTx);

const makeRpcTx = ({addresses, fee, id, raw}) => ({
  amount: '0',
  block_hash: '',
  block_height: 0,
  dest_addresses: addresses,
  num_confirmations: 0,
  previous_outpoints: [],
  raw_tx_hex: raw,
  time_stamp: '1',
  total_fees: String(fee || 0),
  tx_hash: id,
});

const simpleCoopWalletTxs = [
  makeRpcTx({
    addresses: ['address1', 'address2'],
    id: simpleCoopTxId,
    raw: simpleCoopTx,
  }),
];

const anchorWalletTxs = [
  makeRpcTx({addresses: [], id: anchorCommitTxId, raw: anchorCommitTx}),
  makeRpcTx({addresses: [], id: feeFundingTxId, raw: feeFundingTx}),
  makeRpcTx({addresses: [], id: balanceSweepTxId, raw: balanceSweepTx}),
  makeRpcTx({addresses: [], id: anchorCpfpTxId, raw: anchorSweepTx}),
  makeRpcTx({addresses: [], id: htlcTimeoutTxId, raw: htlcTimeoutTx}),
  makeRpcTx({addresses: [], id: otherCommitTxId, raw: otherCommitTx}),
  makeRpcTx({addresses: [], id: sharedSweepTxId, raw: sharedSweepTx}),
  makeRpcTx({addresses: [], id: htlcCommitTxId, raw: htlcCommitTx}),
  makeRpcTx({
    addresses: [],
    id: sharedSecondLevelTxId,
    raw: sharedSecondLevelTx,
  }),
  makeRpcTx({
    addresses: [],
    id: sharedSecondStageTxId,
    raw: sharedSecondStageTx,
  }),
];

const walletTxs = [
  makeRpcTx({addresses: ['address1', 'address2'], id: coopTxId, raw: coopTx}),
  makeRpcTx({addresses: ['address3'], id: commitTxId, raw: commitTx}),
  makeRpcTx({addresses: ['address4'], fee: 300, id: sweepTxId, raw: sweepTx}),
];

const makeClosedChannel = overrides => {
  const channel = {
    alias_scids: [],
    capacity: String(capacity),
    chan_id: '1',
    channel_point: `${coopFundingTxId}:0`,
    close_height: 990,
    close_initiator: 'INITIATOR_REMOTE',
    close_type: 'COOPERATIVE_CLOSE',
    closing_tx_hash: coopTxId,
    open_initiator: 'INITIATOR_LOCAL',
    remote_pubkey: peerKey,
    resolutions: [],
    settled_balance: '60000',
    time_locked_balance: '0',
  };

  Object.keys(overrides).forEach(k => channel[k] = overrides[k]);

  return channel;
};

const coopChannel = makeClosedChannel({});

const forceChannel = makeClosedChannel({
  chan_id: '0',
  channel_point: `${forceFundingTxId}:1`,
  close_height: 995,
  close_initiator: 'INITIATOR_UNKNOWN',
  close_type: 'REMOTE_FORCE_CLOSE',
  closing_tx_hash: commitTxId,
  open_initiator: 'INITIATOR_REMOTE',
  resolutions: [{
    amount_sat: '98000',
    outcome: 'CLAIMED',
    outpoint: {output_index: 0, txid_str: commitTxId},
    resolution_type: 'COMMIT',
    sweep_txid: sweepTxId,
  }],
  settled_balance: '98000',
});

const lookupChannel = makeClosedChannel({
  channel_point: `${lookupFundingTxId}:0`,
  closing_tx_hash: lookupCloseTxId,
});

const lookupWalletTxs = [
  makeRpcTx({addresses: [], id: lookupFundingTxId, raw: lookupFundingTx}),
];

const anchorBalanceResolution = {
  amount_sat: '92340',
  outcome: 'CLAIMED',
  outpoint: {output_index: 0, txid_str: anchorCommitTxId},
  resolution_type: 'COMMIT',
  sweep_txid: balanceSweepTxId,
};

// An anchor channel force closed by the peer who also opened it
const anchorChannel = makeClosedChannel({
  chan_id: '2',
  channel_point: `${anchorFundingTxId}:0`,
  close_height: 995,
  close_type: 'REMOTE_FORCE_CLOSE',
  closing_tx_hash: anchorCommitTxId,
  open_initiator: 'INITIATOR_REMOTE',
  resolutions: [
    anchorBalanceResolution,
    {
      amount_sat: '330',
      outcome: 'CLAIMED',
      outpoint: {output_index: 2, txid_str: anchorCommitTxId},
      resolution_type: 'ANCHOR',
      sweep_txid: anchorCpfpTxId,
    },
    {
      amount_sat: '5000',
      outcome: 'TIMEOUT',
      outpoint: {output_index: 1, txid_str: anchorCommitTxId},
      resolution_type: 'OUTGOING_HTLC',
      sweep_txid: htlcTimeoutTxId,
    },
  ],
  settled_balance: '92340',
});

// Another channel whose balance was swept together with the anchor channel
const otherChannel = makeClosedChannel({
  chan_id: '3',
  channel_point: `${otherFundingTxId}:0`,
  close_height: 995,
  close_type: 'REMOTE_FORCE_CLOSE',
  closing_tx_hash: otherCommitTxId,
  open_initiator: 'INITIATOR_REMOTE',
  resolutions: [{
    amount_sat: '92340',
    outcome: 'CLAIMED',
    outpoint: {output_index: 0, txid_str: otherCommitTxId},
    resolution_type: 'COMMIT',
    sweep_txid: sharedSweepTxId,
  }],
  settled_balance: '92340',
});

// Two stage resolutions of an HTLC shared in a second level tx
const makeSharedHtlcResolutions = ({commitTxId, vout}) => [
  {
    amount_sat: '5000',
    outcome: 'FIRST_STAGE',
    outpoint: {output_index: 1, txid_str: commitTxId},
    resolution_type: 'INCOMING_HTLC',
    sweep_txid: sharedSecondLevelTxId,
  },
  {
    amount_sat: '4800',
    outcome: 'CLAIMED',
    outpoint: {output_index: vout, txid_str: sharedSecondLevelTxId},
    resolution_type: 'INCOMING_HTLC',
    sweep_txid: sharedSecondStageTxId,
  },
];

// A channel with an HTLC that shares a second level tx with the anchor channel
const htlcChannel = makeClosedChannel({
  chan_id: '4',
  channel_point: `${htlcFundingTxId}:0`,
  close_height: 995,
  close_type: 'REMOTE_FORCE_CLOSE',
  closing_tx_hash: htlcCommitTxId,
  open_initiator: 'INITIATOR_REMOTE',
  resolutions: makeSharedHtlcResolutions({
    commitTxId: htlcCommitTxId,
    vout: 1,
  }),
  settled_balance: '0',
});

// A pending force close whose balance is swept with the anchor channel
const pendingForceClose = {
  channel: {
    capacity: String(capacity),
    channel_point: `${otherFundingTxId}:0`,
    local_balance: '0',
    local_chan_reserve_sat: '0',
    remote_balance: '0',
    remote_chan_reserve_sat: '0',
    remote_node_pub: peerKey,
  },
  closing_txid: otherCommitTxId,
  limbo_balance: '92340',
  maturity_height: 0,
  pending_htlcs: [{
    amount: '5000',
    incoming: false,
    maturity_height: 1000,
    outpoint: `${otherCommitTxId}:1`,
  }],
  recovered_balance: '0',
};

const coopClose = {
  capacity,
  blocks_since_close: 10,
  channel_balance_spend: undefined,
  channel_close: coopTxId,
  channel_id: '0x0x1',
  channel_open: `${coopFundingTxId}:0`,
  channel_resolutions: undefined,
  closing_fee_paid: 1000,
  is_breach_close: undefined,
  is_closing_fee_unknown: undefined,
  is_cooperative_close: true,
  is_local_force_close: undefined,
  is_remote_force_close: undefined,
  peer_alias: 'alias',
  peer_closed_channel: true,
  peer_opened_channel: undefined,
  peer_public_key: peerKey,
};

const forceClose = {
  capacity,
  blocks_since_close: 5,
  channel_balance_spend: sweepTxId,
  channel_close: commitTxId,
  channel_id: undefined,
  channel_open: `${forceFundingTxId}:1`,
  channel_resolutions: [{
    transaction_id: sweepTxId,
    type: 'balance_swept',
    value: 98000,
  }],
  closing_fee_paid: sweepFee,
  is_breach_close: undefined,
  is_closing_fee_unknown: undefined,
  is_cooperative_close: undefined,
  is_local_force_close: undefined,
  is_remote_force_close: true,
  peer_alias: 'alias',
  peer_closed_channel: true,
  peer_opened_channel: true,
  peer_public_key: peerKey,
};

// Make a subscription stream that emits data on the next tick
const anchorClose = {
  capacity,
  blocks_since_close: 5,
  channel_balance_spend: balanceSweepTxId,
  channel_close: anchorCommitTxId,
  channel_id: '0x0x2',
  channel_open: `${anchorFundingTxId}:0`,
  channel_resolutions: [
    {transaction_id: balanceSweepTxId, type: 'balance_swept', value: 92340},
    {
      transaction_id: htlcTimeoutTxId,
      type: 'outgoing_htlc_refunded',
      value: 5000,
    },
    {transaction_id: anchorCpfpTxId, type: 'anchor_swept', value: 330},
  ],
  closing_fee_paid: 1300,
  is_breach_close: undefined,
  is_closing_fee_unknown: undefined,
  is_cooperative_close: undefined,
  is_local_force_close: undefined,
  is_remote_force_close: true,
  peer_alias: 'alias',
  peer_closed_channel: true,
  peer_opened_channel: true,
  peer_public_key: peerKey,
};

const makeStream = data => {
  const stream = new EventEmitter();

  stream.cancel = () => {};

  setImmediate(() => stream.emit('data', data));

  return stream;
};

const makeLnd = args => {
  const {block, channels, closedChannels, getNodeInfo, spend, txs} = args;
  const {pendingChannels} = args;

  return {
    blocks: {
      getBlock: ({}, cbk) => {
        const raw = Buffer.from(block || makeBlock([]), 'hex');

        return cbk(null, {raw_block: raw});
      },
      getBlockHash: ({}, cbk) => cbk(null, {block_hash: Buffer.alloc(32)}),
    },
    chain: {
      registerBlockEpochNtfn: ({}) => makeStream({
        hash: Buffer.alloc(32),
        height: currentHeight,
      }),
      registerSpendNtfn: ({}) => {
        const stream = new EventEmitter();

        stream.cancel = () => {};

        // Without a spend the lookup ends without finding anything
        setImmediate(() => {
          if (!spend) {
            return stream.emit('end');
          }

          return stream.emit('data', {
            spend: {
              raw_spending_tx: Buffer.from(spend, 'hex'),
              spending_height: 990,
              spending_input_index: 0,
            },
          });
        });

        return stream;
      },
    },
    default: {
      closedChannels: closedChannels || (({}, cbk) => {
        return cbk(null, {channels: JSON.parse(JSON.stringify(channels))});
      }),
      getNodeInfo: getNodeInfo || (({}, cbk) => {
        return cbk(null, {...getNodeInfoResponse, channels: []});
      }),
      getTransactions: ({}, cbk) => cbk(null, {transactions: txs || []}),
      pendingChannels: pendingChannels || (({}, cbk) => cbk(null, {
        pending_closing_channels: [],
        pending_force_closing_channels: [],
        pending_open_channels: [],
        total_limbo_balance: '0',
        waiting_close_channels: [],
      })),
    },
  };
};

const makeArgs = overrides => {
  const args = {
    lnd: makeLnd({channels: [coopChannel, forceChannel], txs: walletTxs}),
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedLndToGetChannelCloses'],
  },
  {
    args: makeArgs({
      lnd: makeLnd({closedChannels: ({}, cbk) => cbk('err')}),
    }),
    description: 'Errors getting closed channels are passed back',
    error: [503, 'FailedToRetrieveClosedChannels', {err: 'err'}],
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [makeClosedChannel({remote_pubkey: 'remote_pubkey'})],
        txs: walletTxs,
      }),
    }),
    description: 'Errors getting peer aliases are passed back',
    error: [400, 'ExpectedPublicKeyToGetNodeAliasFor'],
  },
  {
    args: makeArgs({lnd: makeLnd({channels: []})}),
    description: 'No closed channels returns no closes',
    expected: {closes: []},
  },
  {
    args: makeArgs({}),
    description: 'Channel closes are returned',
    expected: {closes: [coopClose, forceClose]},
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [
          makeClosedChannel({closing_tx_hash: emptyTxId}),
          makeClosedChannel({close_type: 'FUNDING_CANCELED'}),
          coopChannel,
        ],
        txs: walletTxs,
      }),
    }),
    description: 'Funding cancels and closes without a close tx are skipped',
    expected: {closes: [coopClose]},
  },
  {
    args: makeArgs({limit: 1}),
    description: 'Closes are limited to the most recent closes',
    expected: {closes: [forceClose]},
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [coopChannel],
        getNodeInfo: ({}, cbk) => cbk('err'),
        txs: walletTxs,
      }),
    }),
    description: 'Peer aliases are omitted when unknown',
    expected: {closes: [{...coopClose, peer_alias: undefined}]},
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [
          makeClosedChannel({
            close_initiator: 'INITIATOR_LOCAL',
            closing_tx_hash: Buffer.alloc(32, 9).toString('hex'),
          }),
        ],
        txs: walletTxs,
      }),
    }),
    description: 'Closing fees are unknown when the close tx is unknown',
    expected: {
      closes: [{
        ...coopClose,
        channel_close: Buffer.alloc(32, 9).toString('hex'),
        closing_fee_paid: undefined,
        is_closing_fee_unknown: true,
        peer_closed_channel: undefined,
      }],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [{
          ...forceChannel,
          close_initiator: 'INITIATOR_LOCAL',
          close_type: 'LOCAL_FORCE_CLOSE',
          open_initiator: 'INITIATOR_LOCAL',
        }],
        txs: walletTxs,
      }),
    }),
    description: 'Local force closes pay commitment and sweep fees',
    expected: {
      closes: [{
        ...forceClose,
        closing_fee_paid: 2000 + sweepFee,
        is_local_force_close: true,
        is_remote_force_close: undefined,
        peer_closed_channel: undefined,
        peer_opened_channel: undefined,
      }],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [{...forceChannel, close_type: 'BREACH_CLOSE'}],
        txs: walletTxs,
      }),
    }),
    description: 'Breach closes are returned',
    expected: {
      closes: [{
        ...forceClose,
        is_breach_close: true,
        is_remote_force_close: undefined,
        peer_closed_channel: undefined,
      }],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [{...forceChannel, resolutions: []}],
        txs: walletTxs,
      }),
    }),
    description: 'Force closes without resolutions have no resolutions',
    expected: {
      closes: [{
        ...forceClose,
        channel_balance_spend: undefined,
        channel_resolutions: undefined,
        closing_fee_paid: undefined,
      }],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [{
          ...forceChannel,
          resolutions: [].concat(forceChannel.resolutions).concat([
            {
              amount_sat: '330',
              outcome: 'CLAIMED',
              outpoint: {output_index: 2, txid_str: commitTxId},
              resolution_type: 'ANCHOR',
              sweep_txid: anchorSweepTxId,
            },
            {
              amount_sat: '5000',
              outcome: 'TIMEOUT',
              outpoint: {output_index: 1, txid_str: commitTxId},
              resolution_type: 'OUTGOING_HTLC',
              sweep_txid: htlcSweepTxId,
            },
          ]),
        }],
        txs: walletTxs,
      }),
    }),
    description: 'Anchor and HTLC resolutions are returned',
    expected: {
      closes: [{
        ...forceClose,
        closing_fee_paid: undefined,
        is_closing_fee_unknown: true,
        channel_resolutions: [
          {transaction_id: sweepTxId, type: 'balance_swept', value: 98000},
          {
            transaction_id: htlcSweepTxId,
            type: 'outgoing_htlc_refunded',
            value: 5000,
          },
          {
            transaction_id: anchorSweepTxId,
            type: 'anchor_swept',
            value: undefined,
          },
        ],
      }],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [{
          ...forceChannel,
          resolutions: [].concat(forceChannel.resolutions).concat([
            {
              amount_sat: '5000',
              outcome: 'FIRST_STAGE',
              outpoint: {output_index: 1, txid_str: commitTxId},
              resolution_type: 'INCOMING_HTLC',
              sweep_txid: secondLevelTxId,
            },
            {
              amount_sat: '4800',
              outcome: 'CLAIMED',
              outpoint: {output_index: 0, txid_str: secondLevelTxId},
              resolution_type: 'INCOMING_HTLC',
              sweep_txid: htlcSweepTxId,
            },
          ]),
        }],
        txs: walletTxs,
      }),
    }),
    description: 'Two stage HTLC resolutions are returned with final outcome',
    expected: {
      closes: [{
        ...forceClose,
        closing_fee_paid: undefined,
        is_closing_fee_unknown: true,
        channel_resolutions: [
          {transaction_id: sweepTxId, type: 'balance_swept', value: 98000},
          {
            transaction_id: htlcSweepTxId,
            type: 'incoming_htlc_paid',
            value: 5000,
          },
        ],
      }],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({channels: [anchorChannel], txs: anchorWalletTxs}),
    }),
    description: 'Anchor and HTLC resolution fees are included',
    expected: {closes: [anchorClose]},
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [{
          ...anchorChannel,
          resolutions: [
            anchorBalanceResolution,
            {
              amount_sat: '330',
              outcome: 'UNCLAIMED',
              outpoint: {output_index: 2, txid_str: anchorCommitTxId},
              resolution_type: 'ANCHOR',
            },
          ],
        }],
        txs: anchorWalletTxs,
      }),
    }),
    description: 'A lost anchor is counted as a closing fee',
    expected: {
      closes: [{
        ...anchorClose,
        channel_resolutions: [
          {
            transaction_id: balanceSweepTxId,
            type: 'balance_swept',
            value: 92340,
          },
          {transaction_id: undefined, type: 'anchor_unclaimed', value: 330},
        ],
        closing_fee_paid: 830,
      }],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [{...anchorChannel, resolutions: [anchorBalanceResolution]}],
        txs: anchorWalletTxs,
      }),
    }),
    description: 'An unreported lost anchor is found in the close transaction',
    expected: {
      closes: [{
        ...anchorClose,
        channel_resolutions: [
          {
            transaction_id: balanceSweepTxId,
            type: 'balance_swept',
            value: 92340,
          },
          {transaction_id: undefined, type: 'anchor_unclaimed', value: 330},
        ],
        closing_fee_paid: 830,
      }],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [
          {
            ...anchorChannel,
            resolutions: [{
              ...anchorBalanceResolution,
              sweep_txid: sharedSweepTxId,
            }],
          },
          otherChannel,
        ],
        txs: anchorWalletTxs,
      }),
    }),
    description: 'Sweep fees shared between closed channels are pro-rated',
    expected: {
      closes: [
        {
          ...anchorClose,
          channel_balance_spend: sharedSweepTxId,
          channel_resolutions: [
            {
              transaction_id: sharedSweepTxId,
              type: 'balance_swept',
              value: 92340,
            },
            {transaction_id: undefined, type: 'anchor_unclaimed', value: 330},
          ],
          closing_fee_paid: 830,
        },
        {
          ...anchorClose,
          channel_balance_spend: sharedSweepTxId,
          channel_close: otherCommitTxId,
          channel_id: '0x0x3',
          channel_open: `${otherFundingTxId}:0`,
          channel_resolutions: [{
            transaction_id: sharedSweepTxId,
            type: 'balance_swept',
            value: 92340,
          }],
          closing_fee_paid: 500,
        },
      ],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [
          {
            ...anchorChannel,
            resolutions: [anchorBalanceResolution].concat(
              makeSharedHtlcResolutions({
                commitTxId: anchorCommitTxId,
                vout: 0,
              })
            ),
          },
          htlcChannel,
        ],
        txs: anchorWalletTxs,
      }),
    }),
    description: 'Fees of a second level tx shared between channels are split',
    expected: {
      closes: [
        {
          ...anchorClose,
          channel_resolutions: [
            {
              transaction_id: balanceSweepTxId,
              type: 'balance_swept',
              value: 92340,
            },
            {
              transaction_id: sharedSecondStageTxId,
              type: 'incoming_htlc_paid',
              value: 5000,
            },
            {transaction_id: undefined, type: 'anchor_unclaimed', value: 330},
          ],
          closing_fee_paid: 500 + 200 + 100 + 330,
        },
        {
          ...anchorClose,
          channel_balance_spend: undefined,
          channel_close: htlcCommitTxId,
          channel_id: '0x0x4',
          channel_open: `${htlcFundingTxId}:0`,
          channel_resolutions: [{
            transaction_id: sharedSecondStageTxId,
            type: 'incoming_htlc_paid',
            value: 5000,
          }],
          closing_fee_paid: 200 + 100,
        },
      ],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [{
          ...anchorChannel,
          resolutions: [
            {...anchorBalanceResolution, sweep_txid: sharedSweepTxId},
          ],
        }],
        pendingChannels: ({}, cbk) => cbk(null, {
          ...pendingChannelsResponse,
          pending_force_closing_channels: [pendingForceClose],
          total_limbo_balance: '92340',
        }),
        txs: anchorWalletTxs,
      }),
    }),
    description: 'Sweep fees shared with pending channels are pro-rated',
    expected: {
      closes: [{
        ...anchorClose,
        channel_balance_spend: sharedSweepTxId,
        channel_resolutions: [
          {
            transaction_id: sharedSweepTxId,
            type: 'balance_swept',
            value: 92340,
          },
          {transaction_id: undefined, type: 'anchor_unclaimed', value: 330},
        ],
        closing_fee_paid: 830,
      }],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [makeClosedChannel({closing_tx_hash: simpleCoopTxId})],
        txs: simpleCoopWalletTxs,
      }),
    }),
    description: 'Simple close fees are not paid when the peer closed',
    expected: {
      closes: [{
        ...coopClose,
        channel_close: simpleCoopTxId,
        closing_fee_paid: undefined,
      }],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [
          makeClosedChannel({
            close_initiator: 'INITIATOR_LOCAL',
            closing_tx_hash: simpleCoopTxId,
            open_initiator: 'INITIATOR_REMOTE',
          }),
        ],
        txs: simpleCoopWalletTxs,
      }),
    }),
    description: 'Simple closing a peer opened channel pays the close fee',
    expected: {
      closes: [{
        ...coopClose,
        channel_close: simpleCoopTxId,
        closing_fee_paid: 1000,
        peer_closed_channel: undefined,
        peer_opened_channel: true,
      }],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        channels: [lookupChannel],
        spend: lookupCloseTx,
        txs: lookupWalletTxs,
      }),
    }),
    description: 'Close txs missing from the wallet are found through LND',
    expected: {
      closes: [{
        ...coopClose,
        channel_close: lookupCloseTxId,
        channel_open: `${lookupFundingTxId}:0`,
      }],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        block: makeBlock([lookupCloseTx]),
        channels: [lookupChannel],
        txs: lookupWalletTxs,
      }),
    }),
    description: 'Close txs missing from the wallet are found in their block',
    expected: {
      closes: [{
        ...coopClose,
        channel_close: lookupCloseTxId,
        channel_open: `${lookupFundingTxId}:0`,
      }],
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({channels: [lookupChannel], txs: lookupWalletTxs}),
    }),
    description: 'Closing fees are unknown when the close tx is not found',
    expected: {
      closes: [{
        ...coopClose,
        channel_close: lookupCloseTxId,
        channel_open: `${lookupFundingTxId}:0`,
        closing_fee_paid: undefined,
        is_closing_fee_unknown: true,
      }],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getChannelCloses(args), error, 'Got expected error');
    } else {
      const closes = await getChannelCloses(args);

      deepEqual(closes, expected, 'Got expected closed channels');
    }

    return;
  });
});
