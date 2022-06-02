const {encode} = require('cbor');
const {grpcProxyServer} = require('ln-service/routers');
const moment = require('moment');
const {restrictMacaroon} = require('ln-service');

const base64AsBuf = base64 => Buffer.from(base64, 'base64');
const bufferAsHex = buffer => buffer.toString('hex');
const expiryMs = n => 1000 * 60 * n;
const maxTimeLimitMinutes = 60;
const {now} = Date;
const path = '/v0/grpc/';

/** Start an LND gateway server

  {
    credentials: {
      cert: <LND Base64 Encoded String>
      socket: <LND Socket String>
    }
    [is_nospend]: <Restrict Credentials To Non-Spending Permissions Bool>
    logger: <Winston Logger Object>
    minutes: <Expire Access in Minutes Number>
    port: <Listen Port Number>
    remote: <Remote Gateway URL String>
  }

  @returns
  {}
*/
module.exports = args => {
  if (!args.credentials) {
    throw new Error('ExpectedCredentialsForLndGateway');
  }

  if (!args.credentials.cert) {
    throw new Error('ExpectedCertToStartLndGateway');
  }

  if (!args.logger) {
    throw new Error('ExpectedLoggerToStartLndGateway');
  }

  if (!args.minutes) {
    throw new Error('ExpectedMinutesToStartLndGateway');
  }

  if (args.minutes > maxTimeLimitMinutes) {
    throw new Error('ExpectedMinutesToBeLessThanOrEqualToOneHour');
  }

  if (!args.port) {
    throw new Error('ExpectedPortToStartLndGateway');
  }

  if (!args.credentials.socket) {
    throw new Error('ExpectedLndRpcSocketToStartLndGateway');
  }

  const expiry = new Date(now() + expiryMs(args.minutes));

  const {macaroon} = restrictMacaroon({
    expires_at: expiry.toISOString(),
    macaroon: args.credentials.macaroon,
  });

  const code = encode({
    macaroon: base64AsBuf(macaroon),
    port: !args.remote ? args.port : undefined,
    url: args.remote || undefined,
  });

  args.logger.info({
    connection_code: bufferAsHex(code),
    expires_at: moment(expiry).calendar(),
  });

  if (!!args.remote) {
    return;
  }

  const log = (err, line) => {
    if (!!err) {
      return args.logger.error({gateway: err});
    }

    return args.logger.info({
      gateway: line,
      is_nospend: !!args.is_nospend,
    })
  };

  const {app, server, wss} = grpcProxyServer({
    log,
    path,
    cert: args.credentials.cert,
    port: args.port,
    socket: args.credentials.socket,
  });

  return {};
};
