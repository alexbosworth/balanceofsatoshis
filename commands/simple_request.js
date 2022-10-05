const https = require('https');

const asQueryString = qs => !!qs ? `?${qs}` : '';
const httpsProtocol = 'https:';
const {keys} = Object;
const {parse} = JSON;

/** Simplified version of request method

  {
    [json]: <Interpret Result as JSON Bool>
    [method]: <HTTPS Method String>
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

  let error;
  const qs = url.searchParams;

  // Include passed query string arguments
  if (!!args.qs) {
    keys(args.qs).forEach(key => qs.set(key, args.qs[key]));
  }

  const req = https.request({
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

    // Response is finished
    res.on('end', () => {
      if (!!error) {
        return cbk(err);
      }

      const combined = Buffer.concat(body).toString();

      if (!args.json) {
        return cbk(null, res, combined);
      }

      try {
        return cbk(null, res, parse(combined));
      } catch (err) {
        return cbk(err);
      }
    });
  });

  req.on('error', err => error = err);
  req.on('timeout', () => {
    req.abort();

    return cbk([503, 'RequestTimedOut']);
  });

  req.end();

  return;
};
