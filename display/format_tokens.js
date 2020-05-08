const {bold} = require('colorette');
const {dim} = require('colorette');
const {green} = require('colorette');

const emptyTokens = ' ';
const level0 = 1e3;
const level1 = 1e6;
const level2 = 4294967;
const tokensAsBigTokens = tokens => !!tokens ? (tokens / 1e8).toFixed(8) : ' ';

/** Format tokens for display

  {
    is_monochrome: <Avoid Applying Colors Bool>
    tokens: <Tokens Number>
  }

  @returns
  {
    display: <Display Formatted Tokens String>
  }
*/
module.exports = args => {
  // Exit early and display nothing when there are no tokens
  if (!args.tokens) {
    return {display: emptyTokens};
  }

  // Exit early and avoid styles when in monochrome mode
  if (!!args.is_monochrome) {
    return {display: tokensAsBigTokens(args.tokens)};
  }

  if (args.tokens < level0) {
    return {display: dim(tokensAsBigTokens(args.tokens))};
  }

  if (args.tokens < level1) {
    return {display: tokensAsBigTokens(args.tokens)};
  }

  if (args.tokens < level2) {
    return {display: green(tokensAsBigTokens(args.tokens))};
  }

  return {display: bold(green(tokensAsBigTokens(args.tokens)))};
};
