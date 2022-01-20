const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {getNetwork} = require('ln-sync');
const {getWalletInfo} = require('ln-service');

const getLnds = require('./get_lnds');

const fs = require('fs');
const {join} = require('path');
const {homedir} = require('os');

const home = '.bos';
const fileName = 'credentials.json';
const path = join(...[homedir(), home]);
const onlineLnds = [];
const savedNodeFolders = [];


module.exports = ({lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      //Check arguments
      validate: cbk => {
        if(!lnd) {
          return cbk([400, 'ExpectedLndForGettingSavedNodes']);
        }

        if(!logger) {
          return cbk([400, 'ExpectedLoggerForGettingSavedNodes']);
        }

        return cbk();
      },

      //Get network of current lnd object
      getCurrentNetwork: ['validate', ({}, cbk) => {
        return getNetwork({lnd}, cbk);
      }],

      //Get public key of current lnd object
      getPublicKey: ['validate', ({}, cbk) => {
        return getWalletInfo({lnd}, cbk);
      }],

      //Get list of saved node folders
      getSavedNodeFolders: ['validate', async ({}) => {
        
        //Read all files in .bos dir and check if its a directory
        try {
          const directories = (path) => {
            return fs.readdirSync(path).filter(function (file) {
              return fs.statSync(path+'/'+file).isDirectory();
            });
          }
          const getDirectories = directories(path);
  
          //check if credentials.json file exists in each folder to know if its a saved node
          getDirectories.forEach(directory => {
            const filePath = join(...[homedir(), home, directory, fileName]);
  
            if(fs.existsSync(filePath)) {
              savedNodeFolders.push(directory);
            }
          });
  
          return {nodes: savedNodeFolders};
        } catch (err) {
          logger.error({error: err});
        }
      }],

      //Get lnd objects for each saved node
      getLnds: ['getSavedNodeFolders', async ({getSavedNodeFolders}) => {

        if(!getSavedNodeFolders || !getSavedNodeFolders.nodes || !getSavedNodeFolders.nodes.length) {
          return;
        }
        try {
          const {nodes} = getSavedNodeFolders;
          
          const lnds = await getLnds({logger, nodes});

          return lnds;
          
        } catch (err) {
          logger.error({error: err});
        }
      }],

      //Get the lnds that are online
      getOnlineLnds: [
      'getLnds', 
      'getCurrentNetwork', 
      'getPublicKey', 
      async ({getLnds, getCurrentNetwork, getPublicKey}) => {
        
        if(!getLnds || !getLnds.lnds || !getLnds.lnds.length) {
          return;
        }

        const {lnds} = getLnds;
        
        //Match the network of current lnd object with list of objects
        for(let i=0; i< lnds.length; i++) {
          try {
            const {network} = await getNetwork({lnd: lnds[i]});

            if(getCurrentNetwork.network === network) {

                const {alias, public_key} = await getWalletInfo({lnd: lnds[i]});

                //remove the current lnd object from the list of objects
                if(public_key !== getPublicKey.public_key) {
                  onlineLnds.push({alias: alias, public_key: public_key, lnd: lnds[i]});
                }
            }
          } catch(err) {
          }
        }
        return onlineLnds;
      }],

    },
    returnResult({reject, resolve, of: 'getOnlineLnds'}, cbk));
  })
}