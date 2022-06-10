const {join} = require('path');

const asyncAuto = require('async/auto');
const asyncDetect = require('async/detect');
const {returnResult} = require('asyncjs-util');

const certPath = ['tls.cert'];
const umbrelUser = 'umbrel';
const umbrelV0Path = '/home/umbrel/umbrel/lnd';
const umbrelV1Path = '/home/umbrel/umbrel/app-data/lightning/data/lnd';

/** Look for the LND directory path

  {
    fs: {
      getFile: <Get File Function>
    }
    os: {
      userInfo: <Get User Info Function>
    }
  }

  @returns via cbk or Promise
  {
    [path]: <Found LND Directory Path String>
  }
*/
module.exports = ({fs, os}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFileSystemMethodsToGetPath']);
        }

        if (!os) {
          return cbk([400, 'ExpectedOperatingSystemMethodsToGetPath']);
        }

        return cbk();
      },

      // Paths to look for
      paths: ['validate', ({}, cbk) => {
        // Exit early when the user is not Umbrel
        if (os.userInfo().username !== umbrelUser) {
          return cbk(null, []);
        }

        return cbk(null, [umbrelV0Path, umbrelV1Path]);
      }],

      // Look through the paths to find a cert file
      findCert: ['paths', ({paths}, cbk) => {
        return asyncDetect(paths, (path, cbk) => {
          return fs.getFile(join(...[path].concat(certPath)), (err, cert) => {
            return cbk(null, !err && !!cert);
          });
        },
        cbk);
      }],

      // Final path result
      path: ['findCert', ({findCert}, cbk) => {
        return cbk(null, {path: findCert || undefined});
      }],
    },
    returnResult({reject, resolve, of: 'path'}, cbk));
  });
};
