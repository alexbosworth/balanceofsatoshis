const {deepEqual} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const {setAutopilot} = require('./../../network');

const tests = [
  {
    args: {},
    description: 'Setting autopilot requires enable status',
    error: [400, 'ExpectedEnabledStatusForAutopilot'],
  },
  {
    args: {is_enabled: false, mirrors: ['example.com']},
    description: 'Setting a mirror and also disabling autopilot is an error',
    error: [400, 'ExpectedNoMirrorsWhenDisablingAutopilot'],
  },
  {
    args: {is_enabled: false, urls: ['example.com']},
    description: 'Setting a url and also disabling autopilot is unsupported',
    error: [400, 'ExpectedNoUrlsWhenDisablingAutopilot'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(setAutopilot(args), error, 'Got expected error');
    } else {
      const autopilot = await setAutopilot(args);

      deepEqual(autopilot, expected.autopilot, 'Got expected autopilot result');
    }

    return;
  });
});
