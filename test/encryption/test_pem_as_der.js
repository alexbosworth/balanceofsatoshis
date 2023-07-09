const {equal} = require('node:assert').strict;
const test = require('node:test');

const {pemAsDer} = require('./../../encryption');

const tests = [
  {
    args: {pem: 'pem\npem\npem'},
    description: 'A PEM is mapped to a DER buffer',
    expected: {der: 'a5e9'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, (t, end) => {
    const {der} = pemAsDer(args);

    equal(der.toString('hex'), expected.der, 'Got expected der encoded pem');

    return end();
  });
});
