const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {getAddressUtxo} = require('./../../chain');

const address = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const emptyTx = '01000000000000000000';
const tokens = 50000;
const txId = Buffer.alloc(32, 1).toString('hex');

const utxosUrl = `https://blockstream.info/api/address/${address}/utxo`;
const txUrl = `https://blockstream.info/api/tx/${txId}/hex`;

// Make a request function responding to Esplora style API paths
const makeRequest = ({err, utxos}) => ({json, url}, cbk) => {
  if (url === utxosUrl && json === true) {
    return cbk(err, null, utxos);
  }

  if (url === txUrl) {
    return cbk(null, {statusCode: 200}, emptyTx);
  }

  return cbk(null, {statusCode: 404});
};

const makeArgs = overrides => {
  const args = {
    address,
    tokens,
    interval: 1,
    network: 'btc',
    request: makeRequest({utxos: [{txid: txId, value: tokens}]}),
    retries: 1,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({address: undefined}),
    description: 'An address is required',
    error: [400, 'ExpectedAddressToGetUtxoFor'],
  },
  {
    args: makeArgs({network: undefined}),
    description: 'A network name is required',
    error: [400, 'ExpectedNetworkNameToGetUtxoForAddress'],
  },
  {
    args: makeArgs({network: 'network'}),
    description: 'A known network is required',
    error: [400, 'UnsupportedNetworkToGetUtxoForAddress'],
  },
  {
    args: makeArgs({request: undefined}),
    description: 'A request function is required',
    error: [400, 'ExpectedRequestMethodToGetUtxoForAddress'],
  },
  {
    args: makeArgs({tokens: undefined}),
    description: 'Tokens are required',
    error: [400, 'ExpectedTokensToGetUtxoForAddress'],
  },
  {
    args: makeArgs({request: makeRequest({err: 'err'})}),
    description: 'Errors getting address utxos are passed back',
    error: [503, 'FailedToGetAddressUtxos', {err: 'err'}],
  },
  {
    args: makeArgs({
      interval: undefined,
      request: (() => {
        let attempts = 0;

        const request = makeRequest({utxos: [{txid: txId, value: tokens}]});

        return (args, cbk) => !attempts++ ? cbk('err') : request(args, cbk);
      })(),
      retries: 2,
    }),
    description: 'Errors getting address utxos are retried',
    expected: {transaction: emptyTx},
  },
  {
    args: makeArgs({request: makeRequest({utxos: {}})}),
    description: 'An array of utxos is expected',
    error: [503, 'ExpectedArrayOfUtxosInAddressUtxosResponse'],
  },
  {
    args: makeArgs({request: makeRequest({utxos: [{value: tokens}]})}),
    description: 'A transaction id is expected in the utxo',
    error: [503, 'ExpectedTransactionIdInUtxoForAddress'],
  },
  {
    args: makeArgs({request: makeRequest({utxos: []})}),
    description: 'Nothing is returned when there are no utxos',
    expected: {},
  },
  {
    args: makeArgs({
      request: makeRequest({utxos: [{txid: txId, value: tokens + 1}]}),
    }),
    description: 'Nothing is returned when there is no matching utxo',
    expected: {},
  },
  {
    args: makeArgs({}),
    description: 'The raw transaction for the matching utxo is returned',
    expected: {transaction: emptyTx},
  },
  {
    args: makeArgs({
      request: makeRequest({
        utxos: [
          {txid: Buffer.alloc(32, 2).toString('hex'), value: tokens - 1},
          {txid: txId, value: tokens},
        ],
      }),
    }),
    description: 'The utxo with matching value is selected',
    expected: {transaction: emptyTx},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(getAddressUtxo(args), error, 'Got expected error');
    } else {
      deepEqual(await getAddressUtxo(args), expected, 'Got expected result');
    }

    return;
  });
});
