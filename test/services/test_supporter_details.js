const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../services/supporter_details');

const offer = 'offer';

const tests = [
  {
    args: {mtokens: '10000000'},
    description: 'A payment from a supporter is shown',
    expected: {
      received: '0.00010000',
      supporter_note: undefined,
      supporter_offer: undefined,
    },
  },
  {
    args: {mtokens: '1500', payer_note: 'Thanks!', payer_offer: offer},
    description: 'The note and the offer of a supporter are shown',
    expected: {
      received: '0.00000001',
      supporter_note: 'Thanks!',
      supporter_offer: offer,
    },
  },
  {
    args: {mtokens: '1000', payer_note: 'a\u001b[2Kb\r\nc\u007fd\u009be'},
    description: 'Control characters in a note are shown as spaces',
    expected: {
      received: '0.00000001',
      supporter_note: 'a [2Kb  c d e',
      supporter_offer: undefined,
    },
  },
  {
    args: {mtokens: '1000', payer_note: ''},
    description: 'An empty note is not shown',
    expected: {
      received: '0.00000001',
      supporter_note: undefined,
      supporter_offer: undefined,
    },
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, (t, end) => {
    deepEqual(method(args), expected, 'Got expected details');

    return end();
  });
});
