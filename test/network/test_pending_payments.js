const {deepEqual} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../network/pending_payments');

const makeChannel = overrides => {
  const channel = {
    id: '0x0x1',
    partner_public_key: 'a',
    pending_payments: [],
  };

  Object.keys(overrides).forEach(k => channel[k] = overrides[k]);

  return channel;
};

const makeInbound = overrides => {
  const payment = {
    id: 'ab',
    is_forward: true,
    is_outgoing: false,
    out_channel: '0x0x2',
    out_payment: 3,
    payment: 1,
    timeout: 540,
    tokens: 101,
  };

  Object.keys(overrides).forEach(k => payment[k] = overrides[k]);

  return payment;
};

const makeOutbound = overrides => {
  const payment = {
    id: 'ab',
    in_channel: '0x0x1',
    in_payment: 1,
    is_forward: true,
    is_outgoing: true,
    payment: 3,
    timeout: 500,
    tokens: 100,
  };

  Object.keys(overrides).forEach(k => payment[k] = overrides[k]);

  return payment;
};

const tests = [
  {
    args: {channels: []},
    description: 'No channels means no pending payments',
    expected: {forwarding: [], sending: []},
  },
  {
    args: {
      channels: [
        makeChannel({
          pending_payments: [
            {id: 'ab', is_outgoing: true, timeout: 600, tokens: 50},
            {id: 'cd', is_outgoing: false, timeout: 600, tokens: 60},
          ],
        }),
      ],
    },
    description: 'Outgoing non-forward HTLCs are sending, incoming ignored',
    expected: {
      forwarding: [],
      sending: [{
        id: 'ab',
        out_channel: '0x0x1',
        out_peer: 'a',
        timeout: 600,
        tokens: 50,
      }],
    },
  },
  {
    args: {
      channels: [
        makeChannel({pending_payments: [makeInbound({})]}),
        makeChannel({
          id: '0x0x2',
          partner_public_key: 'b',
          pending_payments: [makeOutbound({})],
        }),
      ],
    },
    description: 'A forward pairs the outbound HTLC with the inbound HTLC',
    expected: {
      forwarding: [{
        fee: 1,
        in_peer: 'a',
        out_peer: 'b',
        payment: 'ab',
        timeout: 540,
        tokens: 100,
      }],
      sending: [],
    },
  },
  {
    args: {
      channels: [
        makeChannel({
          id: '0x0x2',
          partner_public_key: 'b',
          pending_payments: [makeOutbound({})],
        }),
      ],
    },
    description: 'A forward with an unknown inbound channel is not included',
    expected: {forwarding: [], sending: []},
  },
  {
    args: {
      channels: [
        makeChannel({pending_payments: [makeInbound({payment: 2})]}),
        makeChannel({
          id: '0x0x2',
          partner_public_key: 'b',
          pending_payments: [makeOutbound({})],
        }),
      ],
    },
    description: 'A forward with a missing inbound HTLC is not included',
    expected: {forwarding: [], sending: []},
  },
  {
    args: {
      channels: [
        makeChannel({pending_payments: [makeInbound({})]}),
        makeChannel({
          id: '0x0x2',
          partner_public_key: 'b',
          pending_payments: [makeOutbound({in_payment: 0})],
        }),
      ],
    },
    description: 'A forward from an index zero HTLC needs an index zero HTLC',
    expected: {forwarding: [], sending: []},
  },
  {
    args: {
      channels: [
        makeChannel({pending_payments: [makeInbound({payment: 0})]}),
        makeChannel({
          id: '0x0x2',
          partner_public_key: 'b',
          pending_payments: [makeOutbound({in_payment: 0})],
        }),
      ],
    },
    description: 'A forward from an index zero HTLC is paired with the HTLC',
    expected: {
      forwarding: [{
        fee: 1,
        in_peer: 'a',
        out_peer: 'b',
        payment: 'ab',
        timeout: 540,
        tokens: 100,
      }],
      sending: [],
    },
  },
  {
    args: {
      channels: [
        makeChannel({pending_payments: [makeInbound({out_channel: '0x0x3'})]}),
        makeChannel({
          id: '0x0x2',
          partner_public_key: 'b',
          pending_payments: [makeOutbound({})],
        }),
      ],
    },
    description: 'A forward is paired with the HTLC going to its channel',
    expected: {forwarding: [], sending: []},
  },
];

tests.forEach(({args, description, expected}) => {
  return test(description, () => {
    deepEqual(method(args), expected, 'Got expected pending payments');

    return;
  });
});
