const {authenticatedLndGrpc} = require('ln-service');

const {swapOut} = require('./../../swaps');

// The parent forks this file with the swap details as JSON in the argument
const [,, json] = process.argv;

/** Run a swap out in a child process, relaying its progress to the parent

  {
    cert: <LND Base64 Serialized TLS Cert String>
    confs: <Confirmations to Wait for Deposit Number>
    macaroon: <LND Base64 Serialized Macaroon String>
    max_fee: <Maximum Fee Tokens Number>
    socket: <LND RPC Host:Port Network Address String>
    swap_socket: <Swap Service Host:Port Network Address String>
    tokens: <Tokens Number>
  }

  @exits
  0 when the swap finishes, 1 when the swap fails
*/
const args = JSON.parse(json);

const {lnd} = authenticatedLndGrpc({
  cert: args.cert,
  macaroon: args.macaroon,
  socket: args.socket,
});

// Relay every log message to the parent, so it can kill the swap any time
const logger = {
  error: message => process.send({error: message}),
  info: message => process.send(message),
};

swapOut({
  fetch,
  lnd,
  logger,
  avoid: [],
  confs: args.confs,
  fs: {getFile: (path, cbk) => cbk()},
  max_fee: args.max_fee,
  socket: args.swap_socket,
  tokens: args.tokens,
},
err => {
  // Exit early when the swap failed
  if (!!err) {
    return process.send({error: err}, () => process.exit(1));
  }

  return process.exit();
});
