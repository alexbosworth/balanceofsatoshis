const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const cancelUnsignedSwapIn = require('./../../swaps/cancel_unsigned_swap_in');

const abandoned = 'client did not provide fallback tx signatures';
const id = '01'.repeat(32);
const metadata = {get: () => []};

// LND that cancels invoices, or fails to
const makeLnd = ({err}) => ({
  invoices: {cancelInvoice: ({}, cbk) => cbk(err)},
});

// A swap service that abandons swaps without signatures, or fails to
const makeService = ({err}) => ({
  pushStaticAddressHtlcSigs: ({}, {}, cbk) => cbk(err || {details: abandoned}),
});

const makeArgs = overrides => {
  const args = {
    id,
    metadata,
    lnd: makeLnd({}),
    service: makeService({}),
  };

  Object.keys(overrides).forEach(key => args[key] = overrides[key]);

  return args;
};

// Cancel a swap and note what was logged
const cancel = async args => {
  const logs = [];

  const logger = {
    error: message => logs.push(['error', message]),
    info: message => logs.push(['info', message]),
  };

  await cancelUnsignedSwapIn({...args, logger});

  return logs;
};

const tests = [
  {
    args: makeArgs({id: undefined}),
    description: 'A swap hash is expected',
    error: [400, 'ExpectedSwapHashToCancelUnsignedSwapIn'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedLndToCancelUnsignedSwapIn'],
  },
  {
    args: makeArgs({metadata: undefined}),
    description: 'Auth metadata is expected',
    error: [400, 'ExpectedAuthMetadataToCancelUnsignedSwapIn'],
  },
  {
    args: makeArgs({service: undefined}),
    description: 'A service is expected',
    error: [400, 'ExpectedServiceToCancelUnsignedSwapIn'],
  },
  {
    args: makeArgs({}),
    description: 'The swap and its invoice are canceled',
    expected: [['info', {canceled_swap_in: id}]],
  },
  {
    args: makeArgs({service: makeService({err: 'err'})}),
    description: 'A failure to cancel the swap is reported',
    expected: [
      [
        'error',
        {
          failed_to_cancel_swap_in: [
            503,
            'UnexpectedErrorCancelingSwapIn',
            {err: 'err'},
          ],
        },
      ],
    ],
  },
  {
    args: makeArgs({lnd: makeLnd({err: 'err'})}),
    description: 'A failure to cancel the invoice is reported',
    expected: [
      ['info', {canceled_swap_in: id}],
      [
        'error',
        {
          failed_to_cancel_swap_in_invoice: [
            503,
            'UnexpectedErrorCancelingHodlInvoice',
            {err: 'err'},
          ],
        },
      ],
    ],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(cancel(args), error, 'Got expected error');
    } else {
      deepEqual(await cancel(args), expected, 'Got expected logs');
    }

    return;
  });
});
