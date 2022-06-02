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
module.exports = ({credentials, is_nospend, logger, minutes, port, remote}) => {
  if (!credentials) {
    throw new Error('ExpectedCredentialsForLndGateway');
  }

  if (!credentials.cert) {
    throw new Error('ExpectedCertToStartLndGateway');
  }

  if (!logger) {
    throw new Error('ExpectedLoggerToStartLndGateway');
  }

  if (!minutes) {
    throw new Error('ExpectedMinutesToStartLndGateway');
  }

  if (minutes > maxTimeLimitMinutes) {
    throw new Error('ExpectedMinutesToBeLessThanOrEqualTo60');
  }

  if (!port) {
    throw new Error('ExpectedPortToStartLndGateway');
  }

  if (!credentials.socket) {
    throw new Error('ExpectedLndRpcSocketToStartLndGateway');
  }

  const expiry = new Date(now() + expiryMs(minutes));

  const {macaroon} = restrictMacaroon({
    expires_at: expiry.toISOString(),
    macaroon: credentials.macaroon,
  });

  const code = encode({
    macaroon: base64AsBuf(macaroon),
    port: !remote ? port : undefined,
    url: remote || undefined,
  });

  logger.info({
    connection_code: bufferAsHex(code),
    expires_at: moment(expiry).calendar(),
  });

  if (!!remote) {
    return;
  }

  const log = (err, line) => {
    if (!!err) {
      return logger.error({gateway: err});
    }

    return logger.info({
      gateway: line,
      is_nospend: !!is_nospend,
    })
  };

  const {app, server, wss} = grpcProxyServer({
    log,
    path,
    port,
    cert: credentials.cert,
    socket: credentials.socket,
  });

  return {};
};
