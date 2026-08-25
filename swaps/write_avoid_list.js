const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {isArray} = Array;
const joinWithNewLines = lines => lines.join('\n');
const tempFile = path => `${path}.${process.pid}`;

/** Atomically write the lines of an avoid list file

  The list is written to a temporary file that is swapped into place so that
  concurrent readers of the list never see a partially written file.

  {
    fs: {
      renameFile: <Rename File Function> (from, to, cbk) => {}
      writeFile: <Write File Contents Function> (path, contents, cbk) => {}
    }
    lines: [<Avoid Directive Line String>]
    path: <Path To Avoid List File String>
  }

  @returns via cbk or Promise
*/
module.exports = ({fs, lines, path}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFilesystemMethodsToWriteAvoidList']);
        }

        if (!isArray(lines)) {
          return cbk([400, 'ExpectedAvoidLinesToWriteAvoidList']);
        }

        if (!path) {
          return cbk([400, 'ExpectedPathToAvoidListFileToWriteAvoidList']);
        }

        return cbk();
      },

      // Write the list to a temporary file next to the avoid list
      write: ['validate', ({}, cbk) => {
        return fs.writeFile(tempFile(path), joinWithNewLines(lines), err => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorWritingAvoidList', {err}]);
          }

          return cbk();
        });
      }],

      // Atomically swap the temporary file in place of the avoid list
      swap: ['write', ({}, cbk) => {
        return fs.renameFile(tempFile(path), path, err => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorReplacingAvoidList', {err}]);
          }

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
