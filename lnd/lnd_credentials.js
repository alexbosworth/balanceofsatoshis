const {join} = require('path');
const {readFileSync} = require('fs');

const lndDirectory = require('./lnd_directory');

const b64 = 'base64';
const certPath = ['tls.cert'];
const macaroonPath = ['data', 'chain', 'bitcoin', 'mainnet', 'admin.macaroon'];
const {path} = lndDirectory({});
const socket = 'localhost:10009';

/** Lnd credentials

  {}

  @returns
  {
    cert: <Cert String>
    macaroon: <Macaroon String>
    socket: <Socket String>
  }
*/
module.exports = ({}) => {
  return {
    socket,
    cert: readFileSync(join(...[path].concat(certPath))).toString(b64),
    macaroon: readFileSync(join(...[path].concat(macaroonPath))).toString(b64),
  };
};
