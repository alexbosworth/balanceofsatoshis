const {grpcProxyServer} = require('ln-service/routers');
const {restrictMacaroon} = require('ln-service');

const base64AsHex = base64 => Buffer.from(base64, 'base64').toString('hex');
const defaultExpireMs = 1000 * 60 * 60 * 24 * 7;
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

  const {macaroon} = restrictMacaroon({
    expires_at: new Date(now() + defaultExpireMs).toISOString(),
    macaroon: credentials.macaroon,
  });

  logger.info({macaroon: base64AsHex(macaroon)});

  const log = (err, line) => {
    if (!!err) {
      return logger.err({gateway: err});
    }

    return logger.info({gateway: line})
  }

  const {app, server, wss} = grpcProxyServer({
    log,
    path,
    port,
    cert: credentials.cert,
    socket: credentials.socket,
  });

  return {};
};
