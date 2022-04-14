const asyncAuto = require('async/auto');

const {homedir} = require('os');
const {platform} = require('os');
const {userInfo} = require('os');
const {returnResult} = require('asyncjs-util');

const os = {homedir, platform, userInfo};
const contentType = 'text/plain';
const fetchMethods = require('./fetch_methods');
const getRpcAuth = require('./get_rpc_auth');
const {isArray} = Array;
const method = 'POST';
const requestBody = (n, param) => `{"jsonrpc":"1.0","id":"curltext","method":"${n}","params":${!!param.length ? `["${param}"]` : `[]`}}`;

module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.core_method) {
          return cbk([400, 'ExpectedCoreMethodForBitcoinCoreLookUp']);
        }

        if (!isArray(args.param)) {
          return cbk([400, 'ExpectedArrayOfParamsForBitcoinCoreLookUp']);
        }

        return cbk();
      },

      // Get cookie auth
      rpcAuth: ['validate', ({}, cbk) => {
        return getRpcAuth({os}, cbk);
      }],

      //Get blockcount
      getrawtransaction: ['rpcAuth', async ({rpcAuth}) => {
        if (!rpcAuth) {
          return;
        }

        const body = requestBody(args.core_method, args.param);

        try {
          const response = await fetchMethods({
            contentType,
            method,
            body,
            url: rpcAuth,
          });

        return response;
        
        //Ignore errors and return undefined
        } catch (err) {
          return;
        }

      }],

      //Return result
      result: ['getrawtransaction', ({getrawtransaction}, cbk) => {
        if (!!getrawtransaction) {
          return cbk(null, getrawtransaction);
        }
        
        return cbk();
      }],
    },
    returnResult({reject, resolve, of: 'result'}, cbk));
  });
};