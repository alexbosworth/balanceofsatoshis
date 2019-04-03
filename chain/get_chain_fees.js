const asyncAuto = require('async/auto');
const asyncTimesSeries = require('async/timesSeries');
const {getChainFeeRate} = require('ln-service');
const {lightningDaemon} = require('ln-service');

const {lndCredentials} = require('./../lnd');
const {returnResult} = require('./../async');

const bytesPerKb = 1e3;
const {ceil} = Math;
const defaultBlockCount = 144;
const minFeeRate = 1;
const start = 2;

/** Get chain fees

  {
    [blocks]: <Block Count Number>
    [node]: <Node Name String>
  }

  @returns via cbk
  {
    fee_by_block_target: {
      $number: <Kvbyte Fee Rate Number>
    }
  }
*/
module.exports = ({blocks, node}, cbk) => {
  return asyncAuto({
    // Credentials
    credentials: cbk => lndCredentials({node}, cbk),

    // Lnd
    lnd: ['credentials', ({credentials}, cbk) => {
      return cbk(null, lightningDaemon({
        cert: credentials.cert,
        macaroon: credentials.macaroon,
        service: 'WalletKit',
        socket: credentials.socket,
      }));
    }],

    // Get the fees
    getFees: ['lnd', ({lnd}, cbk) => {
      return asyncTimesSeries((blocks || defaultBlockCount) - 1, (i, cbk) => {
        return getChainFeeRate({
          lnd,
          confirmation_target: start + i,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          if (!res.tokens_per_vbyte || res.tokens_per_vbyte < minFeeRate) {
            return cbk([503, 'UnexpectedChainFeeRateInGetFeesResponse']);
          }

          return cbk(null, {rate: res.tokens_per_vbyte, target: start + i});
        });
      },
      cbk);
    }],

    // Collapse chain fees into steps
    chainFees: ['getFees', ({getFees}, cbk) => {
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

      return cbk(null, {fee_by_block_target: feeByBlockTarget});
    }],
  },
  returnResult({of :'chainFees'}, cbk));
};
