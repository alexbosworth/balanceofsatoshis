const {join} = require('path');
const {URL} = require('url');

const asyncAuto = require('async/auto');
const {parse} = require('ini');
const {returnResult} = require('asyncjs-util');

const lndDirectory = require('./lnd_directory');

const applicationOptions = 'Application Options';
const confPath = ['lnd.conf'];
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
    }
  }

  @returns via cbk or Promise
  {
    [socket]: <RPC Socket String>
  }
*/
module.exports = ({fs, node, os}, cbk) => {
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

        const {path} = lndDirectory({os});

        return fs.getFile(join(...[path].concat(confPath)), (err, conf) => {
          // Don't report errors, the conf file is either there or not
          return cbk(null, conf);
        });
      }],

      // Parse configuration file
      parseConf: ['getConfFile', ({getConfFile}, cbk) => {
        // Exit early when there is nothing to parse
        if (!getConfFile) {
          return cbk();
        }

        try {
          const conf = parse(getConfFile.toString());

          if (!keys(conf).length) {
            throw new Error('ExpectedConfigurationInfoFromConfigFile');
          }

          return cbk(null, conf);
        } catch (err) {
          // Ignore errors in configuration parsing
          return cbk();
        }
      }],

      // Derive the socket from the configuration settings
      deriveSocket: ['parseConf', ({parseConf}, cbk) => {
        // Exit early when there is no conf settings
        if (!parseConf) {
          return cbk();
        }

        const {tlsextraip} = parseConf[applicationOptions] || {};

        if (!tlsextraip) {
          return cbk();
        }

        const url = `${scheme}${parseConf[applicationOptions].rpclisten}`;

        try {
          const {port} = new URL(url);

          if (!port) {
            throw new Error('FailedToDerivePortFromApplicationOptions');
          }

          return cbk(null, `${tlsextraip}:${port}`);
        } catch (err) {
          // Ignore errors
          return cbk();
        }
      }],

      // Socket
      socket: ['deriveSocket', ({deriveSocket}, cbk) => {
        return cbk(null, {socket: deriveSocket});
      }],
    },
    returnResult({reject, resolve, of: 'socket'}, cbk));
  });
};
