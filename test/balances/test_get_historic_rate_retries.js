const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../balances/get_historic_rate');

const dayStart = Date.parse('2017-12-17T00:00:00.000Z') / 1000;

// Coinbase Exchange has a candle for the 10:00 hour of the day
const candles = [[dayStart + 60 * 60 * 10, 18900, 19200, 19000, 19200, 5]];

const tests = [
  {
    answers: [{err: 'err'}, {body: candles}],
    description: 'A failed request is tried again after a second',
    expected: {cents: 1910000},
    waits: [1000],
  },
  {
    answers: [{err: 'err'}, {err: 'err'}, {body: candles}],
    description: 'A request that fails again is tried after two more seconds',
    expected: {cents: 1910000},
    waits: [1000, 2000],
  },
  {
    answers: [{err: 'err'}, {err: 'err'}, {err: 'err'}],
    description: 'A request that keeps failing is an error after three tries',
    error: [503, 'UnexpectedErrorGettingCoinbaseCandles', {err: 'err'}],
    waits: [1000, 2000],
  },
  {
    answers: [{body: {message: 'Refused'}}],
    description: 'A request that Coinbase refuses is not tried again',
    error: [503, 'CoinbaseRefusedCandlesRequest', {err: 'Refused'}],
    waits: [],
  },
  {
    answers: [{body: []}],
    description: 'A day without prices is not tried again',
    error: [503, 'ExpectedCandlesForDayInCoinbaseResponse'],
    waits: [],
  },
];

tests.forEach(({answers, description, error, expected, waits}) => {
  return test(description, async ({mock}) => {
    mock.timers.enable({apis: ['setTimeout']});

    const requests = [];

    const result = method({
      currency: 'BTC',
      date: '2017-12-17T10:30:00.000Z',
      fiat: 'USD',
      from: 'coinbase',
      request: ({}, cbk) => {
        const answer = answers[requests.length];

        requests.push(answer);

        return cbk(answer.err, {statusCode: 200}, answer.body);
      },
    });

    // Each request is tried again after its wait, and not before
    waits.forEach((wait, i) => {
      mock.timers.tick(wait - 1);

      deepEqual(requests.length, i + 1, 'The request waits to be tried again');

      mock.timers.tick(1);

      deepEqual(requests.length, i + 2, 'The request is tried again');
    });

    if (!!error) {
      await rejects(result, error, 'Got expected error');
    } else {
      deepEqual(await result, expected, 'Got expected rate');
    }

    deepEqual(requests.length, answers.length, 'Every answer was used');

    return;
  });
});
