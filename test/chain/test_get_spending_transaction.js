const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('node:events');
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../chain/get_spending_transaction');

const spendingTx = '01000000000000000000';

// Make an LND that responds to a spend registration with an event
const makeLnd = ({emit}) => {
  return {
    chain: {
      registerSpendNtfn: ({}) => {
        const stream = new EventEmitter();

        stream.cancel = () => {};

        setImmediate(() => !!emit ? emit(stream) : undefined);

        return stream;
      },
    },
  };
};

const makeArgs = overrides => {
  const args = {
    lnd: makeLnd({
      emit: stream => stream.emit('data', {
        spend: {
          raw_spending_tx: Buffer.from(spendingTx, 'hex'),
          spending_height: 100,
          spending_input_index: 0,
        },
      }),
    }),
    min_height: 100,
    output_script: `0020${'00'.repeat(32)}`,
    timeout: 1000,
    transaction_id: Buffer.alloc(32).toString('hex'),
    transaction_vout: 0,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is required',
    error: [400, 'ExpectedLndToGetSpendingTransaction'],
  },
  {
    args: makeArgs({min_height: undefined}),
    description: 'A minimum height is required',
    error: [400, 'ExpectedMinHeightToGetSpendingTransaction'],
  },
  {
    args: makeArgs({output_script: undefined}),
    description: 'An output script is required',
    error: [400, 'ExpectedOutputScriptToGetSpendingTransaction'],
  },
  {
    args: makeArgs({transaction_id: undefined}),
    description: 'A transaction id is required',
    error: [400, 'ExpectedTransactionIdToGetSpendingTransaction'],
  },
  {
    args: makeArgs({transaction_vout: undefined}),
    description: 'A transaction output index is required',
    error: [400, 'ExpectedTransactionVoutToGetSpendingTransaction'],
  },
  {
    args: makeArgs({
      lnd: makeLnd({emit: stream => stream.emit('error', {details: 'err'})}),
    }),
    description: 'Errors looking for the spend are passed back',
    error: [503, 'UnexpectedErrorGettingSpend', {err: {details: 'err'}}],
  },
  {
    args: makeArgs({}),
    description: 'The spending transaction is returned',
    expected: {transaction: spendingTx},
  },
  {
    args: makeArgs({lnd: makeLnd({emit: stream => stream.emit('end')})}),
    description: 'No transaction is returned when the subscription ends',
    expected: {},
  },
  {
    args: makeArgs({lnd: makeLnd({}), timeout: 1}),
    description: 'No transaction is returned when the spend is not found',
    expected: {},
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
