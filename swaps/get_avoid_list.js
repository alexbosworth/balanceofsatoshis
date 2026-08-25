const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const matchNewLines = /\r?\n/;
const trim = n => n.trim();
const uniq = arr => Array.from(new Set(arr));

/** Get the list of avoid directives from an avoid list file

  {
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    path: <Path To Avoid List File String>
  }

  @returns via cbk or Promise
  {
    lines: [<Avoid Directive Line String>]
  }
*/
module.exports = ({fs, path}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFilesystemMethodsToGetAvoidList']);
        }

        if (!path) {
          return cbk([400, 'ExpectedPathToAvoidListFileToGetAvoidList']);
        }

        return cbk();
      },

      // Get the lines of the avoid list file
      getList: ['validate', ({}, cbk) => {
        return fs.getFile(path, (err, res) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorGettingAvoidListFile', {err}]);
          }

          const lines = res.toString().split(matchNewLines).map(trim);

          return cbk(null, {lines: uniq(lines.filter(n => !!n))});
        });
      }],
    },
    returnResult({reject, resolve, of: 'getList'}, cbk));
  });
};
