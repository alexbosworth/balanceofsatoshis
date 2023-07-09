const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const method = require('./../../telegram/get_socks_proxy');

const makeArgs = overrides => {
  const agent = {host: 'host'};

  const args = {
    fs: {getFile: (_, cbk) => cbk(null, Buffer.from(JSON.stringify(agent)))},
    path: 'path',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({fs: undefined}),
    description: 'Filesystem methods are expected',
    error: [400, 'ExpectedFileSystemMethodsToGetSocksProxyAgent'],
  },
  {
    args: makeArgs({path: undefined}),
    description: 'A path is expected',
    error: [400, 'ExpectedPathToSocksJsonFileToGetSocksProxyAgent'],
  },
  {
    args: makeArgs({fs: {getFile: (path, cbk) => cbk('err')}}),
    description: 'Errors from getFile are passed back',
    error: [400, 'FailedToFindFileAtProxySpecifiedPath', {err: 'err'}],
  },
  {
    args: makeArgs({fs: {getFile: (path, cbk) => cbk()}}),
    description: 'A result from get file is expected',
    error: [400, 'ExpectedFileDataAtProxySpecifiedPath'],
  },
  {
    args: makeArgs({fs: {getFile: (path, cbk) => cbk(null, Buffer.alloc(1))}}),
    description: 'A valid JSON file is expected',
    error: [400, 'ExpectedValidJsonConfigFileForProxy'],
  },
  {
    args: makeArgs({
      fs: {getFile: (path, cbk) => cbk(null, Buffer.from(JSON.stringify({})))},
    }),
    description: 'Socks agent creation errors are expected',
    error: [503, 'FailedToCreateSocksProxyAgent'],
  },
  {
    args: makeArgs({}),
    description: 'A socks proxy is returned',
    expected: 'SocksProxyAgent',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got error');
    } else {
      const {agent} = await method(args);

      equal(agent.constructor.name, expected, 'Got expected SOCKS proxy');
    }

    return;
  });
});
