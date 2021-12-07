const {test} = require('@alexbosworth/tap');

const method = require('./../../services/balanced_open_accept_details');

const makeArgs = overrides => {
  const records = [
    {
      type: '80503',
      value: Buffer.alloc(70).toString('hex'),
    },
    {
      type: '80505',
      value: Buffer.alloc(33, 3).toString('hex'),
    },
    {
      type: '80506',
      value: Buffer.alloc(33, 2).toString('hex'),
    },
    {
      type: '80507',
      value: Buffer.alloc(32).toString('hex'),
    },
    {
      type: '80508',
      value: '00',
    },
  ]
    .map(record => {
      if (overrides.hasOwnProperty(record.type)) {
        return {type: record.type, value: overrides[record.type]};
      }

      return record;
    })
    .filter(n => n.value !== undefined);

  return {records};
};

const tests = [
  {
    args: makeArgs({'80505': undefined}),
    description: 'A multisig key is expected',
    error: 'AcceptResponseMissingRemotePublicKey',
  },
  {
    args: makeArgs({'80505': '00'}),
    description: 'A valid multisig key is expected',
    error: 'GotInvalidRemotePublicKey',
  },
  {
    args: makeArgs({'80507': undefined}),
    description: 'A transit tx id is expected',
    error: 'AcceptResponseMissingTransitTransactionId',
  },
  {
    args: makeArgs({'80507': '00'}),
    description: 'A valid transit tx id is expected',
    error: 'AcceptResponseMissingTransitTransactionId',
  },
  {
    args: makeArgs({'80508': undefined}),
    description: 'A transit tx vout is expected',
    error: 'AcceptResponseMissingTransitTransactionVout',
  },
  {
    args: makeArgs({'80503': undefined}),
    description: 'A transit signature is expected',
    error: 'AcceptResponseMissingFundingSignature',
  },
  {
    args: makeArgs({'80503': Buffer.alloc(150).toString('hex')}),
    description: 'A valid transit signature is expected',
    error: 'AcceptResponseMissingFundingSignature',
  },
  {
    args: makeArgs({'80506': undefined}),
    description: 'A transit key is expected',
    error: 'AcceptResponseMissingFundTransitKey',
  },
  {
    args: makeArgs({'80506': '00'}),
    description: 'A valid transit key is expected',
    error: 'GotInvalidFundingTransitPublicKey',
  },
  {
    args: makeArgs({'80508': '030303030303030303030303030303030303030303030303030303030303030303'}),
    description: 'A valid transit tx vout is expected',
    error: 'AcceptResponseMissingTransitTransactionVout',
  },
  {
    args: makeArgs({}),
    description: 'Balanced open details are derived',
    expected: {
      funding_signature: '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001',
      multisig_public_key: '030303030303030303030303030303030303030303030303030303030303030303',
      transaction_id: '0000000000000000000000000000000000000000000000000000000000000000',
      transaction_vout: 0,
      transit_public_key: '020202020202020202020202020202020202020202020202020202020202020202',
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({end, equal, throws, strictSame}) => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got error');
    } else {
      strictSame(method(args), expected, 'Got expected result');
    }

    return end();
  });
});
