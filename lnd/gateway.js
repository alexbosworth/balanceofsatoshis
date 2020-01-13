const {grpcProxyServer} = require('ln-service/routers');

const {log} = console;
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
module.exports = ({credentials, port}) => {
  if (!credentials) {
    throw new Error('ExpectedCredentialsForLndGateway');
  }

  if (!credentials.cert) {
    throw new Error('ExpectedCertToStartLndGateway');
  }

  if (!port) {
    throw new Error('ExpectedPortToStartLndGateway');
  }

  if (!credentials.socket) {
    throw new Error('ExpectedLndRpcSocketToStartLndGateway');
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
