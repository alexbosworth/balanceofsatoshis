const {writeFile} = require('fs');

const paddingLength = '  '.length;
const {stringify} = JSON;

/** Write JSON to a file

  {
    file: <File Path String>
    json: <JSON Object>
  }
*/
module.exports = ({file, json}, cbk) => {
  if (!file) {
    return cbk([400, 'ExpectedPathToWriteJsonFile']);
  }

  if (!json) {
    return cbk([400, 'ExpectedJsonToWriteToJsonFile']);
  }

  return writeFile(file, stringify(json, null, paddingLength), err => {
    if (!!err) {
      return cbk([503, 'FailedToWriteJsonToFile', err]);
    }

    return cbk();
  });
};
