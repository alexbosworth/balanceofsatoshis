const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {idForTransaction} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const method = require('./../../chain/get_channel_resolution');

const fundingTxId = Buffer.alloc(32, 1).toString('hex');
const otherTxId = Buffer.alloc(32, 2).toString('hex');
const signature = Buffer.alloc(71, 3).toString('hex');

// Make a hex encoded segwit transaction
const makeTx = ({inputs, outputs}) => {
  return transactionFromComponents({
    inputs: inputs.map(input => ({
      id: input.id,
      script: '',
      sequence: input.sequence || 0,
      vout: input.vout,
      witness: input.witness || [signature, `02${'04'.repeat(32)}`],
    })),
    locktime: 0,
    outputs,
    version: 2,
  }).transaction;
};

const idOf = transaction => idForTransaction({transaction}).id;

// The commitment transaction spends the funding output into two outputs
const commitTx = makeTx({
  inputs: [{id: fundingTxId, sequence: 2147483648, vout: 0}],
  outputs: [
    {script: `0014${'05'.repeat(20)}`, tokens: 12345},
    {script: `0020${'06'.repeat(32)}`, tokens: 67890},
  ],
});

const commitTxId = idOf(commitTx);

// The sweep transaction spends an unrelated coin and the commitment output
const sweepTx = makeTx({
  inputs: [
    {id: otherTxId, vout: 0},
    {
      id: commitTxId,
      sequence: 144,
      vout: 1,
      witness: [signature, '', '63'.repeat(10)],
    },
  ],
  outputs: [{script: `0014${'07'.repeat(20)}`, tokens: 67000}],
});

const sweepTxId = idOf(sweepTx);

// A second transaction spending both commitment outputs
const spendAllTx = makeTx({
  inputs: [
    {id: commitTxId, vout: 0},
    {
      id: commitTxId,
      sequence: 144,
      vout: 1,
      witness: [signature, '', '63'.repeat(10)],
    },
  ],
  outputs: [{script: `0014${'08'.repeat(20)}`, tokens: 80000}],
});

const spendAllTxId = idOf(spendAllTx);

const outspends = [{spent: false}, {spent: true, txid: sweepTxId, vin: 1}];

const commitEntry = {
  id: commitTxId,
  output_addresses: ['address1', 'address2'],
  transaction: commitTx,
};

const sweepEntry = {
  id: sweepTxId,
  output_addresses: ['address3'],
  transaction: sweepTx,
};

// Make a request function responding to Esplora style API paths
const makeRequest = overrides => ({json, url}, cbk) => {
  const [path] = Object.keys(overrides).filter(n => url.endsWith(n));

  if (!!path) {
    return overrides[path](cbk);
  }

  if (url.endsWith('/outspends')) {
    return cbk(null, {statusCode: 200}, outspends);
  }

  if (url.endsWith(`${commitTxId}/hex`)) {
    return cbk(null, {statusCode: 200}, commitTx);
  }

  if (url.endsWith(`${sweepTxId}/hex`)) {
    return cbk(null, {statusCode: 200}, sweepTx);
  }

  return cbk(null, {statusCode: 404});
};

const makeArgs = overrides => {
  const args = {
    close_transaction_id: commitTxId,
    network: 'btc',
    request: makeRequest({}),
    transactions: [commitEntry, sweepEntry],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const expectedResolutions = {
  resolutions: [
    {type: 'unspent', value: 12345},
    {transaction_id: sweepTxId, type: 'unknown', value: 67890},
  ],
};

const tests = [
  {
    args: makeArgs({close_transaction_id: undefined}),
    description: 'A close transaction id is required',
    error: [400, 'ExpectedCloseTransactionIdToGetChanResolution'],
  },
  {
    args: makeArgs({network: undefined}),
    description: 'A network name is required',
    error: [400, 'ExpectedNodeNetworkNameToGetChannelResolution'],
  },
  {
    args: makeArgs({request: undefined}),
    description: 'A request function is required',
    error: [400, 'ExpectedRequestFunctionToGetChannelResolution'],
  },
  {
    args: makeArgs({
      request: makeRequest({[`${commitTxId}/hex`]: cbk => cbk('err')}),
      transactions: [],
    }),
    description: 'Errors getting the commitment tx are passed back',
    error: [503, 'UnexpectedErrorGettingCommitTxInfo', 'err'],
  },
  {
    args: makeArgs({
      request: makeRequest({[`${commitTxId}/hex`]: cbk => cbk()}),
      transactions: [],
    }),
    description: 'A response is expected when getting the commitment tx',
    error: [503, 'UnexpectedResponseCodeWhenGettingCommitTx'],
  },
  {
    args: makeArgs({
      request: makeRequest({
        [`${commitTxId}/hex`]: cbk => cbk(null, {statusCode: 500}),
      }),
      transactions: [],
    }),
    description: 'A success code is expected when getting the commitment tx',
    error: [503, 'UnexpectedResponseCodeWhenGettingCommitTx'],
  },
  {
    args: makeArgs({
      request: makeRequest({
        [`${commitTxId}/hex`]: cbk => cbk(null, {statusCode: 200}),
      }),
      transactions: [],
    }),
    description: 'A commitment transaction is expected in the response',
    error: [503, 'ExpectedTransactionForCommitTxId'],
  },
  {
    args: makeArgs({request: makeRequest({'/outspends': cbk => cbk('err')})}),
    description: 'Errors getting outspends are passed back',
    error: [503, 'UnexpectedErrorGettingOutspentsForTx', 'err'],
  },
  {
    args: makeArgs({request: makeRequest({'/outspends': cbk => cbk()})}),
    description: 'A response is expected when getting outspends',
    error: [503, 'UnexpectedResponseCodeWhenGettingOutspends'],
  },
  {
    args: makeArgs({
      request: makeRequest({
        '/outspends': cbk => cbk(null, {statusCode: 500}),
      }),
    }),
    description: 'A success code is expected when getting outspends',
    error: [503, 'UnexpectedResponseCodeWhenGettingOutspends'],
  },
  {
    args: makeArgs({
      request: makeRequest({
        '/outspends': cbk => cbk(null, {statusCode: 200}, {}),
      }),
    }),
    description: 'An array of outspends is expected',
    error: [503, 'ExpectedJsonResultForTransactionOutspents'],
  },
  {
    args: makeArgs({
      request: makeRequest({
        '/outspends': cbk => cbk(null, {statusCode: 200}, [{spent: true}]),
      }),
    }),
    description: 'Spent outspends are expected to have spending details',
    error: [503, 'UnexpectedResultFromOutspendQuery', [{spent: true}]],
  },
  {
    args: makeArgs({
      request: makeRequest({[`${sweepTxId}/hex`]: cbk => cbk('err')}),
      transactions: [commitEntry],
    }),
    description: 'Errors getting spending transactions are passed back',
    error: [503, 'UnexpectedErrorGettingSpentTxInfo', 'err'],
  },
  {
    args: makeArgs({
      request: makeRequest({[`${sweepTxId}/hex`]: cbk => cbk()}),
      transactions: [commitEntry],
    }),
    description: 'A response is expected when getting spending transactions',
    error: [503, 'UnexpectedResponseCodeWhenGettingTx'],
  },
  {
    args: makeArgs({
      request: makeRequest({
        [`${sweepTxId}/hex`]: cbk => cbk(null, {statusCode: 500}),
      }),
      transactions: [commitEntry],
    }),
    description: 'A success code is expected getting spending transactions',
    error: [503, 'UnexpectedResponseCodeWhenGettingTx'],
  },
  {
    args: makeArgs({
      request: makeRequest({
        [`${sweepTxId}/hex`]: cbk => cbk(null, {statusCode: 200}),
      }),
      transactions: [commitEntry],
    }),
    description: 'A spending transaction is expected in the response',
    error: [503, 'ExpectedTransactionForSpendTxId'],
  },
  {
    args: makeArgs({is_cooperative_close: true}),
    description: 'Cooperative closes have no resolutions',
    expected: {},
  },
  {
    args: makeArgs({
      transactions: [{
        id: commitTxId,
        output_addresses: [],
        transaction: commitTx,
      }],
    }),
    description: 'No resolutions are returned when there are no outputs',
    expected: undefined,
  },
  {
    args: makeArgs({}),
    description: 'Get resolutions using pre-provided transactions',
    expected: expectedResolutions,
  },
  {
    args: makeArgs({transactions: []}),
    description: 'Get resolutions using requested transactions',
    expected: expectedResolutions,
  },
  {
    args: makeArgs({
      request: makeRequest({
        '/outspends': cbk => cbk(null, {statusCode: 200}, [
          {spent: true, txid: spendAllTxId, vin: 0},
          {spent: true, txid: spendAllTxId, vin: 1},
        ]),
        [`${spendAllTxId}/hex`]: cbk => {
          return cbk(null, {statusCode: 200}, spendAllTx);
        },
      }),
      transactions: [commitEntry],
    }),
    description: 'A spending transaction is only requested once',
    expected: {
      resolutions: [
        {transaction_id: spendAllTxId, type: 'p2wpkh', value: 12345},
        {transaction_id: spendAllTxId, type: 'unknown', value: 67890},
      ],
    },
  },
  {
    args: makeArgs({
      transactions: [
        commitEntry,
        {id: spendAllTxId, output_addresses: [], transaction: spendAllTx},
      ],
    }),
    description: 'Get resolutions when all outputs are spent locally',
    expected: {
      resolutions: [
        {transaction_id: spendAllTxId, type: 'p2wpkh', value: 12345},
        {transaction_id: spendAllTxId, type: 'unknown', value: 67890},
      ],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      deepEqual(await method(args), expected, 'Got expected result');
    }

    return;
  });
});
