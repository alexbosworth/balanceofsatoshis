const {stringify} = require('querystring');

const {AbortController} = require('abort-controller');

const encodeQs = qs => !qs ? '' : '?' + stringify(qs);
const isPrivateHost = host => /^(127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|localhost$|0\.0\.0\.0$|\[?::1\]?$)/.test((host || '').toLowerCase());
const timeoutSignals = new WeakMap();

/** Derive a request function that uses fetch to simulate request behavior

  {
    fetch: <Node Fetch Function>
  }

  @returns
  {
    request: <Request Function>
  }
*/
module.exports = ({fetch}, cbk) => {
  return (options, cbk) => {
    (async () => {
    	const controller = new AbortController();

      // Setup the timeout controller
      if (!!options.timeout) {
        const timeout = setTimeout(() => controller.abort(), options.timeout);

        timeoutSignals.set(controller.signal, timeout);
      }

      const url = options.url + encodeQs(options.qs);

      let parsedUrl;

      try {
        parsedUrl = new URL(url);
      } catch (err) {
        return cbk([400, 'ExpectedValidUrlToFetch', {err}]);
      }

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return cbk([400, 'UnsupportedUrlProtocolToFetch']);
      }

      if (isPrivateHost(parsedUrl.hostname)) {
        return cbk([400, 'RequestToPrivateAddressNotAllowed']);
      }

      try {
        // Make the request
        const response = await fetch(url, {
          body: options.body || undefined,
          method: options.method || undefined,
          signal: controller.signal,
        });

        const res = {statusCode: response.status};

        if (!!options.json) {
          return cbk(null, res, await response.json());
        } else {
          return cbk(null, res, await response.text());
        }
      } catch (err) {
        // Return request errors back
        return cbk(err);
      } finally {
        // Reset the timeout since the request is over
        if (!!options.timeout) {
          clearTimeout(timeoutSignals.get(controller.signal));
        }
      }
    })();
  };
};
