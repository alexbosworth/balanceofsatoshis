const asyncAuto = require('async/auto');
const asyncTimesSeries = require('async/timesSeries');
const {getChainFeeRate} = require('ln-service');
const {getHeight} = require('ln-service');
const {getMinimumRelayFee} = require('ln-service');
const {returnResult} = require('asyncjs-util');

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
    lnd: <Authenticated LND gRPC API Object>
  }

  @returns via cbk or Promise
  {
    current_block_hash: <Chain Tip Best Block Hash Hex String>
    fee_by_block_target: {
      $number: <Kvbyte Fee Rate Number>
    }
    min_relay_feerate: <Chain Backend Minimum KVbyte Fee Rate Number>
  }
*/
module.exports = ({blocks, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToGetChainFees']);
        }

        return cbk();
      },

      // Get the fees
      getFees: ['validate', ({}, cbk) => {
        const blockCount = blocks || defaultBlockCount;

        return asyncTimesSeries(blockCount - iteration, (i, cbk) => {
          return getChainFeeRate({
            lnd,
            confirmation_target: start + i,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {rate: res.tokens_per_vbyte, target: start + i});
          });
        },
        cbk);
      }],

      // Get chain info
      getHeight: ['validate', ({}, cbk) => getHeight({lnd}, cbk)],

      // Get the minimum relay fee rate
      getMinFee: ['validate', ({}, cbk) => getMinimumRelayFee({lnd}, cbk)],

      // Collapse chain fees into steps
      chainFees: [
        'getFees',
        'getHeight',
        'getMinFee',
        ({getFees, getHeight, getMinFee}, cbk) =>
      {
        let cursor = {};
        const feeByBlockTarget = {};

        getFees
          .filter(fee => {
            const isNewFee = cursor.rate !== fee.rate;

            cursor = isNewFee ? fee : cursor;

            return isNewFee;
          })
          .forEach(({target, rate}) => {
            return feeByBlockTarget[target+''] = ceil(rate * bytesPerKb);
          });

        return cbk(null, {
          current_block_hash: getHeight.current_block_hash,
          fee_by_block_target: feeByBlockTarget,
          min_relay_feerate: ceil(getMinFee.tokens_per_vbyte * bytesPerKb),
        });
      }],
    },
    returnResult({reject, resolve, of :'chainFees'}, cbk));
  });
};
