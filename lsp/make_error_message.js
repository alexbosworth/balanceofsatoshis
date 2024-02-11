const {versionJsonRpc} = require('./lsps1_protocol');

/** Make an error message

  {
    code: <Error Code Number>
    data: <Error Data Object>
    id: <Request Id Number or String>
    message: <Error Message string>
  }

  @throws
  <Error>

  @returns
  {
    error: {
      code: <Error Code Number>
      data: <Error Data Object>
      message: <Error Message string>
    }
    id: <Request Id Number or String>
    jsonrpc: <JSON RPC Version String>
  }
*/
module.exports = ({code, data, id, message}) => {
  if (!code) {
    throw new Error('ExpectedErrorCodeToMakeErrorMessage');
  }

  if (!data) {
    throw new Error('ExpectedErrorDataToMakeErrorMessage');
  }

  if (!id) {
    throw new Error('ExpectedIdToMakeErrorMessage');
  }

  if (!message) {
    throw new Error('ExpectedErrorMessageToMakeErrorMessage');
  }

  return {id, error: {code, data, message}, jsonrpc: versionJsonRpc};
};
