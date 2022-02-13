const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {SocksProxyAgent} = require('socks-proxy-agent');

const {parse} = JSON;

/** Get a SOCKS proxy given a JSON configuration file path

  {
    fs: {
      getFile: <Get File From Filesystem Function>
    }
    path: <Path To Proxy Configuration JSON File String>
  }

  @returns via cbk or Promise
  {
    agent: <Socks Proxy Agent Object>
  }
*/
module.exports = ({fs, path}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFileSystemMethodsToGetSocksProxyAgent']);
        }

        if (!path) {
          return cbk([400, 'ExpectedPathToSocksJsonFileToGetSocksProxyAgent']);
        }

        return cbk();
      },

      // Get the configuration file
      getFile: ['validate', ({}, cbk) => {
        return fs.getFile(path, (err, res) => {
          if (!!err) {
            return cbk([400, 'FailedToFindFileAtProxySpecifiedPath', {err}]);
          }

          if (!res) {
            return cbk([400, 'ExpectedFileDataAtProxySpecifiedPath']);
          }

          return cbk(null, res.toString());
        });
      }],

      // Construct the SOCKS proxy agent
      agent: ['getFile', ({getFile}, cbk) => {
        try {
          parse(getFile);
        } catch (err) {
          return cbk([400, 'ExpectedValidJsonConfigFileForProxy', {err}]);
        }

        const {host, password, port, userId} = parse(getFile);

        try {
          const agent = new SocksProxyAgent({
            password,
            port,
            userId,
            hostname: host,
          });

          return cbk(null, {agent});
        } catch (err) {
          return cbk([503, 'FailedToCreateSocksProxyAgent', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'agent'}, cbk));
  });
};
