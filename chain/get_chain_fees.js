const asyncAuto = require('async/auto');
const asyncTimesSeries = require('async/timesSeries');
const {getChainFeeRate} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {authenticatedLnd} = require('./../lnd');

const bytesPerKb = 1e3;
const {ceil} = Math;
const defaultBlockCount = 144;
const iteration = 1;
const minFeeRate = 1;
const start = 2;

/** Get chain fees

  Requires that the lnd is built with walletrpc

  {
    [blocks]: <Block Count Number>
    [node]: <Node Name String>
  }

  @returns via cbk
  {
    current_block_hash: <Chain Tip Best Block Hash Hex String>
    fee_by_block_target: {
      $number: <Kvbyte Fee Rate Number>
    }
  }
*/
module.exports = ({blocks, node}, cbk) => {
  return asyncAuto({
    // Authenticated lnd
    getLnd: cbk => authenticatedLnd({node}, cbk),

    // Get wallet info
    getInfo: ['getLnd', ({getLnd}, cbk) => {
      return getWalletInfo({lnd: getLnd.lnd}, cbk);
    }],

    // Get the fees
    getFees: ['getLnd', ({getLnd}, cbk) => {
      const blockCount = blocks || defaultBlockCount;

      return asyncTimesSeries(blockCount - iteration, (i, cbk) => {
        return getChainFeeRate({
          confirmation_target: start + i,
          lnd: getLnd.lnd,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          // Exit with error when there is an invalid fee rate response
          if (!res.tokens_per_vbyte || res.tokens_per_vbyte < minFeeRate) {
            return cbk([503, 'UnexpectedChainFeeRateInGetFeesResponse']);
          }

          return cbk(null, {rate: res.tokens_per_vbyte, target: start + i});
        });
      },
      cbk);
    }],

    // Collapse chain fees into steps
    chainFees: ['getFees', 'getInfo', ({getFees, getInfo}, cbk) => {
      let cursor = {};
      const feeByBlockTarget = {};

      getFees
        .filter(fee => {
          const isNewFee = cursor.rate !== fee.rate;

          cursor = isNewFee ? fee : cursor;

          return isNewFee;
        })
        .forEach(fee => {
          return feeByBlockTarget[fee.target+''] = ceil(fee.rate * bytesPerKb);
        });

      return cbk(null, {
        current_block_hash: getInfo.current_block_hash,
        fee_by_block_target: feeByBlockTarget,
      });
    }],
  },
  returnResult({of :'chainFees'}, cbk));
};
