const {test} = require('tap');

const {getUtxos} = require('./../../chain');

const utxo = {
  address: 'address',
  amount_sat: '1',
  confirmations: '1',
  outpoint: {bytes: Buffer.alloc(1), output_index: 0, txid_str: '00'},
  pk_script: '00',
  type: 'NESTED_PUBKEY_HASH',
};

const tests = [
  {
    args: {},
    description: 'LND is required',
    error: [400, 'ExpectedLndObjectToGetUtxos'],
  },
  {
    args: {
      lnd: {default: {listUnspent: ({}, cbk) => cbk(null, {utxos: [utxo]})}},
    },
    description: 'Utxos are returned',
    expected: {
      address: 'address',
      address_format: 'np2wpkh',
      confirmation_count: 1,
      output_script: '00',
      tokens: 1,
      transaction_id: '00',
      transaction_vout: 0,
    },
  },
  {
    args: {
      count_below: 1,
      lnd: {default: {listUnspent: ({}, cbk) => cbk(null, {utxos: [utxo]})}},
    },
    description: 'No count below',
    expected: {count: 0},
  },
  {
    args: {
      count_below: 5,
      is_confirmed: true,
      lnd: {
        default: {
          listUnspent: ({}, cbk) => cbk(null, {
            utxos: [{
              address: 'address',
              amount_sat: '2',
              confirmations: '1',
              outpoint: {
                bytes: Buffer.alloc(1),
                output_index: 0,
                txid_str: '00',
              },
              pk_script: '00',
              type: 'NESTED_PUBKEY_HASH',
            }],
          }),
        },
      },
      min_tokens: 1,
    },
    description: 'A count below a target is returned',
    expected: {count: 4},
  },
  {
    args: {
      is_count: 1,
      lnd: {
        default: {
          listUnspent: ({}, cbk) => cbk(null, {
            utxos: [{
              address: 'address',
              amount_sat: '2',
              confirmations: '1',
              outpoint: {
                bytes: Buffer.alloc(1),
                output_index: 0,
                txid_str: '00',
              },
              pk_script: '00',
              type: 'NESTED_PUBKEY_HASH',
            }],
          }),
        },
      },
      min_tokens: 1,
    },
    description: 'Just a count is returned',
    expected: {count: 1},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects}) => {
    if (!!error) {
      rejects(getUtxos(args), error, 'Got expected error');
    } else if (!args.count_below && !args.is_count) {
      const {utxos} = await getUtxos(args);

      const [utxo, none] = utxos;

      equal(none, undefined, 'Only one UTXO returned');
      equal(utxo.address, expected.address, 'Got expected address');
      equal(utxo.address_format, expected.address_format, 'Got addr format');
      equal(utxo.confirmation_count, expected.confirmation_count, 'Got confs');
      equal(utxo.output_script, expected.output_script, 'Got output script');
      equal(utxo.tokens, expected.tokens, 'Got expected tokens');
      equal(utxo.transaction_id, expected.transaction_id, 'Got expected txid');
      equal(utxo.transaction_vout, expected.transaction_vout, 'Got vout');
    } else {
      const count = await getUtxos(args);

      equal(count, expected.count, 'Got expected count');
    }

    return end();
  });
});
