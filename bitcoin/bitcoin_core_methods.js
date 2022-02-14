const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const contentType = 'text/plain';
const fetchMethods = require('./fetch_methods');
const method = 'POST';
const requestBody = n => `{"jsonrpc":"1.0","id":"curltext","method":"${n}","params":[]}`;

module.exports = ({core_method}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!core_method) {
          return cbk([400, 'ExpectedBitcoinCoreMethodForLookUp']);
        }

        return cbk();
      },

      //Get blockcount
      getBlockcount: ['validate', async ({}) => {
        const body = requestBody(core_method);
        const url = 'http://__cookie__:8c7c278c62f3729a700cb1660c1a511ecd54e1b489951425def23b1e28753412@127.0.0.1:18444/';
        
        try {
          const response = await fetchMethods({
            contentType,
            method,
            body,
            url,
          });

        return response;

        } catch (err) {
          throw new Error (err);
        }

      }],

      result: ['getBlockcount', ({getBlockcount}, cbk) => {
        return cbk(null, getBlockcount);
      }],
    },
    returnResult({reject, resolve, of: 'getBlockcount'}, cbk));
  });
};