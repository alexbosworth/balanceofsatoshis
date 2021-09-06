const {parseErrors} = require('./constants');

const defaultError = '#ERROR!';

/** Describe a hot formula parser error

  {
    error: <Error Type String>
  }

  @returns
  <Display String>
*/
module.exports = ({error}) => {
  return parseErrors[error] || parseErrors[defaultError];
};
