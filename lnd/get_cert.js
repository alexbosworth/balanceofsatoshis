const {homedir} = require('os');
const {join} = require('path');
const {platform} = require('os');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const lndDirectory = require('./lnd_directory');

const certPath = ['tls.cert'];

/** Get cert for node

  {
    fs: {
      getFile: <Get File Function>
    }
    [node]: <Node Name String>
    os: {
      homedir: <Home Directory Function> () => <Home Directory Path String>
      platform: <Platform Function> () => <Platform Name String>
    }
  }

  @returns via cbk or Promise
  {
    [cert]: <Cert File Base64 Encoded String>
  }
*/
module.exports = ({fs, node, os}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFileSystemMethodsToGetCertForNode']);
        }

        if (!os) {
          return cbk([400, 'ExpectedOperatingSystemMethodsToGetCertForNode']);
        }

        return cbk();
      },

      // Get certificate
      getCert: ['validate', ({}, cbk) => {
        if (!!node) {
          return cbk();
        }

        const {path} = lndDirectory({os});

        return fs.getFile(join(...[path].concat(certPath)), (err, cert) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorGettingCertFileData', {err}]);
          }

          if (!cert) {
            return cbk([503, 'LndCertNotFoundInDefaultLocation']);
          }

          return cbk(null, cert.toString('base64'));
        });
      }],

      // Cert
      cert: ['getCert', ({getCert}, cbk) => cbk(null, {cert: getCert})],
    },
    returnResult({reject, resolve, of: 'cert'}, cbk));
  });
};
