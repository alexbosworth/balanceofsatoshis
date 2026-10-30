const {join} = require('path');
const {URL} = require('url');

const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const {parse} = require('ini');
const {returnResult} = require('asyncjs-util');

const lndDirectory = require('./lnd_directory');

const applicationOptions = 'Application Options';
const confPath = ['lnd.conf'];
const isOnion = socket => /^[^\s]+\.onion/.test(socket.split(':').shift());
const {keys} = Object;
const scheme = 'rpc://';

/** Get RPC socket for a node

  {
    fs: {
      getFile: <Get Filesystem File Function> (path, cbk) => {}
    }
    [node]: <Saved Node Name String>
    os: {
      homedir: <Home Directory Function> () => <Home Directory Path String>
      platform: <Platform Function> () => <Platform Name String>
      userInfo: <User Info Function> () => {username: <User Name String>}
    }
    [path]: <Lnd Data Directory Path String>
  }

  @returns via cbk or Promise
  {
    [socket]: <RPC Socket String>
  }
*/
module.exports = ({fs, node, os, path}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFilesystemMethodsToGetSocketInfoForNode']);
        }

        if (!os) {
          return cbk([400, 'ExpectedOperatingSystemMethodsToGetNodeSocket']);
        }

        return cbk();
      },

      // Get configuration file
      getConfFile: ['validate', ({}, cbk) => {
        // Exit early when a saved node is specified
        if (!!node) {
          return cbk();
        }

        const dir = path || lndDirectory({os}).path;

        return fs.getFile(join(...[dir].concat(confPath)), (err, conf) => {
          // Don't report errors, the conf file is either there or not
          return cbk(null, conf);
        });
      }],

      // Parse configuration file
      parseConf: ['getConfFile', asyncify(({getConfFile}) => {
        // Exit early when there is nothing to parse
        if (!getConfFile) {
          return;
        }

        try {
          const conf = parse(getConfFile.toString());

          if (!keys(conf).length) {
            throw new Error('ExpectedConfigurationInfoFromConfigFile');
          }

          return conf;
        } catch (err) {
          // Ignore errors in configuration parsing
          return;
        }
      })],

      // Derive the RPC host
      deriveHost: ['parseConf', ({parseConf}, cbk) => {
        // Exit early when there is no conf settings
        if (!parseConf) {
          return cbk();
        }

        const {tlsextradomain} = parseConf[applicationOptions] || {};

        if (!tlsextradomain) {
          return cbk();
        }

        if (isOnion(tlsextradomain)) {
          return cbk();
        }

        return cbk(null, tlsextradomain);
      }],

      // Derive the RPC socket from the configuration settings
      deriveSocket: [
        'deriveHost',
        'parseConf',
        asyncify(({deriveHost, parseConf}) =>
      {
        // Exit early when there is no conf settings or TLS host
        if (!deriveHost || !parseConf) {
          return;
        }

        const url = `${scheme}${parseConf[applicationOptions].rpclisten}`;

        try {
          const {port} = new URL(url);

          if (!port) {
            throw new Error('FailedToDerivePortFromApplicationOptions');
          }

          return `${deriveHost}:${port}`;
        } catch (err) {
          // Ignore errors
          return;
        }
      })],

      // Socket
      socket: ['deriveSocket', ({deriveSocket}, cbk) => {
        return cbk(null, {socket: deriveSocket});
      }],
    },
    returnResult({reject, resolve, of: 'socket'}, cbk));
  });
};
