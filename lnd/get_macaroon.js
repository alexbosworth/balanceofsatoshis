const {join} = require('path');

const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const {returnResult} = require('asyncjs-util');

const lndDirectory = require('./lnd_directory');

const defaults = [['bitcoin', 'litecoin'], ['mainnet', 'testnet']];
const flatten = arr => [].concat(...arr);
const macDirs = ['data', 'chain'];
const macName = 'admin.macaroon';

/** Get macaroon for node

  {
    fs: {
      getFile: <Get File Function> (path, cbk) => {}
    }
    [node]: <Node Name String>
    os: {
      homedir: <Home Directory Function> () => <Home Directory Path String>
      platform: <Platform Function> () => <Platform Name String>
    }
  }

  @returns via cbk or Promise
  {
    [macaroon]: <Base64 Encoded Macaroon String>
  }
*/
module.exports = ({fs, node, os}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFileSystemMethodsToGetMacaroon']);
        }

        if (!os) {
          return cbk([400, 'ExpectedOperatingSystemMethodsToGetMacaroon']);
        }

        return cbk();
      },

      // Get macaroon
      getMacaroon: ['validate', ({}, cbk) => {
        // Exit early when a saved node was specified
        if (!!node) {
          return cbk(null, {});
        }

        const [chains, nets] = defaults;
        let defaultMacaroon;
        const {path} = lndDirectory({os});

        const all = chains.map(chain => {
          return nets.map(network => ({chain, network}));
        });

        // Find the default macaroon
        return asyncDetectSeries(flatten(all), ({chain, network}, cbk) => {
          const macPath = [].concat(macDirs).concat([chain, network, macName]);

          return fs.getFile(join(...[path].concat(macPath)), (_, macaroon) => {
            defaultMacaroon = macaroon;

            return cbk(null, !!defaultMacaroon);
          });
        },
        () => {
          if (!defaultMacaroon) {
            return cbk([503, 'FailedToGetMacaroonFileFromDefaultLocation']);
          }

          return cbk(null, {macaroon: defaultMacaroon.toString('base64')});
        });
      }],
    },
    returnResult({reject, resolve, of: 'getMacaroon'}, cbk));
  });
};
