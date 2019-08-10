const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const paddingLength = '  '.length;
const {stringify} = JSON;

/** Write JSON to a file

  {
    file: <File Path String>
    json: <JSON Object>
    write: (path, data, (err) => {})
  }

  @returns via cbk or Promise
*/
module.exports = ({file, json, write}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!file) {
          return cbk([400, 'ExpectedPathToWriteJsonFile']);
        }

        if (!json) {
          return cbk([400, 'ExpectedJsonToWriteToJsonFile']);
        }

        if (!write) {
          return cbk([400, 'ExpectedWriteMethodToWriteToJsonFile']);
        }

        return cbk();
      },

      // Write file
      write: ['validate', ({}, cbk) => {
        return write(file, stringify(json, null, paddingLength), err => {
          if (!!err) {
            return cbk([503, 'FailedToWriteJsonToFile', {err}]);
          }

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
