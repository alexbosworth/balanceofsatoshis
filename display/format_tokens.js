const {bold} = require('colorette');
const {dim} = require('colorette');
const {green} = require('colorette');

const level0 = 1e3;
const level1 = 1e6;
const level2 = 4294967;
const tokensAsBigTokens = tokens => !!tokens ? (tokens / 1e8).toFixed(8) : '';

/** Format tokens for display

  {
    tokens: <Tokens Number>
  }

  @returns
  {
    display: <Display Formatted Tokens String>
  }
*/
module.exports = ({tokens}) => {
  // Exit early and display nothing when there are no tokens
  if (!tokens) {
    return {display: String()};
  }

  if (tokens < level0) {
    return {display: dim(tokensAsBigTokens(tokens))};
  }

  if (tokens < level1) {
    return {display: tokensAsBigTokens(tokens)};
  }

  if (tokens < level2) {
    return {display: green(tokensAsBigTokens(tokens))};
  }

  return {display: bold(green(tokensAsBigTokens(tokens)))};
};
