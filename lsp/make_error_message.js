

module.exports = ({code, data, message}) => {
  if (!code) {
    throw new Error('ExpectedErrorCodeToMakeErrorMessage');
  }

  if (!data) {
    throw new Error('ExpectedErrorDataToMakeErrorMessage');
  }

  if (!message) {
    throw new Error('ExpectedErrorMessageToMakeErrorMessage');
  }

  return {
    jsonrpc: "2.0",
    error: {
      code,
      message,
      data,
    }
  };
}