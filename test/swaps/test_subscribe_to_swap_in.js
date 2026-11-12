const {deepEqual} = require('node:assert').strict;
const EventEmitter = require('node:events');
const test = require('node:test');

const subscribeToSwapIn = require('./../../swaps/subscribe_to_swap_in');

const bufferAsHex = buffer => buffer.toString('hex');
const events = ['coop_settlement', 'error', 'risk_accepted', 'risk_rejected'];
const hash = Buffer.alloc(32, 3);
const metadata = {get: () => []};
const streamError = 'UnexpectedSwapInStatusSubscriptionError';

const id = bufferAsHex(hash);

// The service accepted the risk of the swap utxos
const accepted = {
  notification: 'static_loop_in_risk_accepted',
  static_loop_in_risk_accepted: {swap_hash: hash},
};

// A notification without the swap it is about
const invalid = {
  notification: 'static_loop_in_risk_accepted',
  static_loop_in_risk_accepted: {},
};

// The service stopped waiting for the swap utxos
const rejected = {
  notification: 'static_loop_in_risk_rejected',
  static_loop_in_risk_rejected: {swap_hash: hash},
};

// A fake swap service that keeps the notification streams it makes
const makeService = () => {
  const service = {streams: []};

  service.subscribeNotifications = ({}, auth) => {
    const stream = new EventEmitter();

    stream.cancel = () => stream.is_canceled = true;

    service.streams.push(stream);

    return stream;
  };

  return service;
};

// Take a step: drive the latest stream, move the clock, count or stop
const takeStep = ({emitted, mock, service, step, sub}) => {
  const [type, details] = step;
  const [stream] = service.streams.slice().reverse();

  switch (type) {
  case 'count':
    return emitted.push(['subscriptions', service.streams.length]);

  case 'remove':
    return sub.removeAllListeners();

  case 'tick':
    return mock.timers.tick(details);

  default:
    return stream.emit(type, details);
  }
};

// Take the steps of a test and note what the subscription did
const run = ({mock, steps}) => {
  const emitted = [];
  const service = makeService();

  const sub = subscribeToSwapIn({metadata, service});

  events.forEach(event => {
    return sub.on(event, details => emitted.push([event, details]));
  });

  steps.forEach(step => takeStep({emitted, mock, service, step, sub}));

  const canceled = service.streams.filter(n => !!n.is_canceled);

  return {
    canceled: canceled.length,
    events: emitted,
    subscriptions: service.streams.length,
  };
};

const tests = [
  {
    description: 'Swap in events are relayed',
    expected: {
      canceled: 0,
      events: [['risk_accepted', {id}], ['risk_rejected', {id}]],
      subscriptions: 1,
    },
    steps: [['data', accepted], ['data', rejected]],
  },
  {
    description: 'An invalid notification is an error that keeps the stream',
    expected: {
      canceled: 0,
      events: [
        ['error', [503, 'ExpectedSwapHashInServiceNotification']],
        ['subscriptions', 1],
      ],
      subscriptions: 1,
    },
    steps: [['data', invalid], ['tick', 60000], ['count']],
  },
  {
    description: 'An ended stream is subscribed again after ten seconds',
    expected: {
      canceled: 1,
      events: [['subscriptions', 1], ['subscriptions', 2]],
      subscriptions: 2,
    },
    steps: [['end'], ['tick', 9999], ['count'], ['tick', 1], ['count']],
  },
  {
    description: 'A failed stream is subscribed again after ten seconds',
    expected: {
      canceled: 1,
      events: [
        ['error', [503, streamError, {err: 'err'}]],
        ['subscriptions', 2],
      ],
      subscriptions: 2,
    },
    steps: [['error', 'err'], ['tick', 10000], ['count']],
  },
  {
    description: 'Every quick failure waits another second',
    expected: {
      canceled: 2,
      events: [['subscriptions', 2], ['subscriptions', 3]],
      subscriptions: 3,
    },
    steps: [
      ['end'],
      ['tick', 10000],
      ['end'],
      ['tick', 10999],
      ['count'],
      ['tick', 1],
      ['count'],
    ],
  },
  {
    description: 'A stream that stayed up starts the delays over',
    expected: {
      canceled: 2,
      events: [['subscriptions', 3]],
      subscriptions: 3,
    },
    steps: [
      ['end'],
      ['tick', 10000],
      ['tick', 60000],
      ['end'],
      ['tick', 10000],
      ['count'],
    ],
  },
  {
    description: 'Removing the listeners stops the stream',
    expected: {canceled: 1, events: [], subscriptions: 1},
    steps: [['remove'], ['tick', 60000]],
  },
  {
    description: 'Removing the listeners stops subscribing again',
    expected: {canceled: 1, events: [], subscriptions: 1},
    steps: [['end'], ['remove'], ['tick', 60000]],
  },
];

tests.forEach(({description, expected, steps}) => {
  return test(description, ({mock}) => {
    mock.timers.enable({apis: ['setTimeout']});

    deepEqual(run({mock, steps}), expected, 'Got expected events');

    return;
  });
});
