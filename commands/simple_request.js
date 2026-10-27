const https = require('https');

const asQueryString = qs => !!qs ? `?${qs}` : '';
const httpsProtocol = 'https:';
const {keys} = Object;
const {parse} = JSON;

/** Simplified version of request method

  {
    [headers]: <Request Headers Object>
    [json]: <Interpret Result as JSON Bool>
    [method]: <HTTPS Method String>
    [qs]: <Query String Arguments Object>
    [timeout]: <Timeout MS Number>
    url: <HTTPS URL String>
  }

  @returns
  <Response Object>
  <Response Body>
*/
module.exports = (args, cbk) => {
  if (!args.url) {
    return cbk([400, 'ExpectedUrlToExecuteSimpleRequest']);
  }

  const url = new URL(args.url);

  if (url.protocol !== httpsProtocol) {
    return cbk([400, 'ExpectedHttpsProtocolToExecuteSimpleRequest']);
  }

  let isFinished = false;
  const qs = url.searchParams;

  // Call back once, since a request that times out also errors
  const finish = (err, res, body) => {
    // Exit early when the request has already called back
    if (isFinished) {
      return;
    }

    isFinished = true;

    return cbk(err, res, body);
  };

  // Include passed query string arguments
  if (!!args.qs) {
    keys(args.qs).forEach(key => qs.set(key, args.qs[key]));
  }

  const req = https.request({
    headers: args.headers,
    hostname: url.hostname,
    method: args.method,
    path: url.pathname + asQueryString(qs.toString()),
    port: url.port,
    timeout: args.timeout,
  },
  res => {
    const body = [];

    // Collect response chunks
    res.on('data', data => body.push(data));

    // A response that is cut off is an error
    res.on('error', err => {
      return finish([503, 'UnexpectedErrorReceivingSimpleRequest', {err}]);
    });

    // Response is finished
    res.on('end', () => {
      const combined = Buffer.concat(body).toString();

      // Exit early when the response is not meant to be JSON
      if (!args.json) {
        return finish(null, res, combined);
      }

      // Only the parsing is guarded, so the callback is called once
      const parsed = (() => {
        try {
          return {json: parse(combined)};
        } catch (err) {
          return {err};
        }
      })();

      // Exit early when the response is not JSON
      if (!!parsed.err) {
        return finish([503, 'ExpectedJsonResponseToSimpleRequest', {
          err: parsed.err,
        }]);
      }

      return finish(null, res, parsed.json);
    });
  });

  // A request that fails before it is answered is an error
  req.on('error', err => {
    return finish([503, 'UnexpectedErrorExecutingSimpleRequest', {err}]);
  });

  // A request that is not answered in time is an error
  req.on('timeout', () => {
    finish([503, 'RequestTimedOut']);

    // The request is stopped, and the error that comes of it is not passed on
    return req.destroy();
  });

  req.end();

  return;
};
