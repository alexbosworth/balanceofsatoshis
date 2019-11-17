const asyncAuto = require('async/auto');
const {duration} = require('moment');
const {info} = require('cert-info');
const {returnResult} = require('asyncjs-util');

const lndCredentials = require('./lnd_credentials');

const {now} = Date;
const {round} = Math;

/** Get the number of days a node's cert is still valid

  {
    [below]: <Days Above Watermark Number>
    [logger]: <Winston Logger Object>
    [node]: <Saved Node Name String>
  }

  @returns via cbk or Promise
  {
    days: <Days Valid Number>
  }
*/
module.exports = ({below, logger, node}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Get the cert
      getCredentials: cbk => lndCredentials({logger, node}, cbk),

      // Determine the number of days remaining for the cert to be valid
      certValidity: ['getCredentials', ({getCredentials}, cbk) => {
        const {cert} = getCredentials;

        const {expiresAt} = info(Buffer.from(cert, 'base64').toString());

        const valid = duration(expiresAt - now()).asDays();

        const days = !below ? valid : (valid < below ? below - valid : 0);

        return cbk(null, {days: round(days)});
      }],
    },
    returnResult({reject, resolve, of: 'certValidity'}, cbk));
  });
};
