const {stringify} = require('querystring');

const encodeQs = qs => !qs ? '' : '?' + stringify(qs);
const timeoutSignals = new WeakMap();

/** Derive a request function that uses fetch to simulate request behavior

  {
    fetch: <Fetch Function>
  }

  @returns
  <Request Function> (args, cbk) => {}
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

      // Only the request is guarded, so the callback is called once
      const fetched = await (async () => {
        try {
          // Make the request
          const response = await fetch(url, {
            body: options.body || undefined,
            method: options.method || undefined,
            signal: controller.signal,
          });

          const res = {statusCode: response.status};

          // Exit early when the response is JSON
          if (!!options.json) {
            return {res, body: await response.json()};
          }

          return {res, body: await response.text()};
        } catch (err) {
          return {err};
        } finally {
          // Reset the timeout since the request is over
          if (!!options.timeout) {
            clearTimeout(timeoutSignals.get(controller.signal));
          }
        }
      })();

      // Exit early when the request failed
      if (!!fetched.err) {
        return cbk(fetched.err);
      }

      return cbk(null, fetched.res, fetched.body);
    })();
  };
};
