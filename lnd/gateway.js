const {encode} = require('cbor');
const {grpcProxyServer} = require('ln-service/routers');
const moment = require('moment');
const {restrictMacaroon} = require('ln-service');

const base64AsBuf = base64 => Buffer.from(base64, 'base64');
const defaultExpireMs = 1000 * 60 * 10;
const {now} = Date;
const path = '/v0/grpc/';

/** Start an LND gateway server

  {
    credentials: {
      cert: <LND Base64 Encoded String>
      socket: <LND Socket String>
    }
    port: <Listen Port Number>
  }

  @returns
  {}
*/
module.exports = ({credentials, logger, port}) => {
  if (!credentials) {
    throw new Error('ExpectedCredentialsForLndGateway');
  }

  if (!credentials.cert) {
    throw new Error('ExpectedCertToStartLndGateway');
  }

  if (!logger) {
    throw new Error('ExpectedLoggerToStartLndGateway');
  }

  if (!port) {
    throw new Error('ExpectedPortToStartLndGateway');
  }

  if (!credentials.socket) {
    throw new Error('ExpectedLndRpcSocketToStartLndGateway');
  }

  const expiry = new Date(now() + defaultExpireMs);

  const {macaroon} = restrictMacaroon({
    expires_at: expiry.toISOString(),
    macaroon: credentials.macaroon,
  });

  const code = encode({port, macaroon: base64AsBuf(macaroon)}).toString('hex');

  logger.info({connection_code: code, expires_at: moment(expiry).calendar()});

  const log = (err, line) => {
    if (!!err) {
      return logger.err({gateway: err});
    }

    return logger.info({gateway: line})
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
