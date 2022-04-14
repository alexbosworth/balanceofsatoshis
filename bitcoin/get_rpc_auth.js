const asyncAuto = require('async/auto');
const platforms = require('./platforms');
const {readFile} = require('fs');
const {returnResult} = require('asyncjs-util');

const fs = {getFile: readFile};
const {join} = require('path');
const {keys} = Object;
const {parse} = require('ini');
const umbrelPath = '/home/umbrel/umbrel/bitcoin/bitcoin.conf';
const umbrelUser = 'umbrel';

module.exports = ({os}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!os) {
          return cbk([400, 'ExpectedOperatingSytemMethodsToGetCookieAuthFile']);
        }
      
        if (!os.homedir) {
          return cbk([400, 'ExpectedHomedirFunctionToGetCookieAuthFile']);
        }
      
        if (!os.platform) {
          return cbk([400, 'ExpectedPlatformFunctionToGetCookieAuthFile']);
        }
      
        if (!os.userInfo) {
          return cbk([400, 'ExpectedUserInfoFunctionToGetCookieAuthFile']);
        }

        return cbk();
      },

      //Get Path to cookie file
      getBitcoinConfPath: ['validate', ({}, cbk) => {
          // The default directory on Umbrel is not the normal path
        try {
          if (os.userInfo().username === umbrelUser) {
          return cbk(null, {path: umbrelPath});
          }
        } catch {} // Ignore errors

        switch (os.platform()) {
          case platforms.macOS:
            return cbk(null, {path: join(os.homedir(), 'Library', 'Application Support', 'Bitcoin', 'bitcoin.conf')});
            
          case platforms.windows:
            return cbk(null, {path: join(os.homedir(), 'AppData', 'Bitcoin', 'bitcoin.conf')});
              
          default:
            return cbk(null, {path: join(os.homedir(), '.bitcoin', 'bitcoin.conf')});
        }
      }],

      getConfFile: ['getBitcoinConfPath', ({getBitcoinConfPath}, cbk) => {
        const {path} = getBitcoinConfPath;

        return fs.getFile(path, (err, conf) => {
          if (!!err) {
            return cbk();
          }
          
          return cbk(null, conf);
        });
      }],

      // Parse configuration file
      parseConf: ['getConfFile', ({getConfFile}, cbk) => {
        // Exit early when there is nothing to parse
        if (!getConfFile) {
          return cbk();
        }

        try {
          const conf = parse(getConfFile.toString());

          if (!keys(conf).length) {
            return cbk();
          }

          return cbk(null, conf);
        } catch (err) {
          // Ignore errors in configuration parsing
          return cbk();
        }
      }],

      // Derive the RPC Auth
      deriveDetails: ['parseConf', ({parseConf}, cbk) => {
        // Exit early when there is no conf settings
        if (!parseConf) {
          return cbk();
        }

        const {rpcauth} = parseConf || {};
        const {testnet} = parseConf || {};
        const {regtest} = parseConf || {};
        const {rpcport} = parseConf || {};

        if (!rpcauth) {
          return cbk();
        }
        
        const url = `http://${rpcauth}@127.0.0.1:${!!rpcport ? rpcport : !!testnet ? 18332 : !!regtest ? 18444 : 8332}/`;

        return cbk(null, url);
      }],

      //Return result
      result: ['deriveDetails', ({deriveDetails}, cbk) => {
        return cbk(null, deriveDetails);
      }],
    },
    returnResult({reject, resolve, of: 'result'}, cbk));
  });
};

