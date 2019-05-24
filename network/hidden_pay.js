const asyncAuto = require('async/auto');
const {authenticatedLndGrpc} = require('ln-service');
const {calculatePaths} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNetworkGraph} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {parsePaymentRequest} = require('ln-service');
const {pay} = require('ln-service');
const {probe} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {routeFromHops} = require('ln-service');

const {lndCredentials} = require('./../lnd');

/** Pay an invoice using only non-public IP node channels

  {
    [node]: <Node Name String>
    request: <Payment Request String>
  }

  @returns via cbk
  {
    [success]: {
      fee: <Fee Tokens To Destination Number>
    }
  }
*/
module.exports = ({node, request}, cbk) => {
  return asyncAuto({
    // Credentials
    credentials: cbk => lndCredentials({node}, cbk),

    // Lnd
    lnd: ['credentials', ({credentials}, cbk) => {
      return cbk(null, authenticatedLndGrpc({
        cert: credentials.cert,
        macaroon: credentials.macaroon,
        socket: credentials.socket,
      }).lnd);
    }],

    // Decode payment request
    decodeRequest: ['lnd', ({lnd}, cbk) => {
      try {
        return cbk(null, parsePaymentRequest({request}));
      } catch (err) {
        return cbk([400, 'FailedToDecodePayReq', err]);
      }
    }],

    // Get the channels
    getChannels: ['lnd', ({lnd}, cbk) => getChannels({lnd}, cbk)],

    // Get the network graph
    getGraph: ['lnd', ({lnd}, cbk) => getNetworkGraph({lnd}, cbk)],

    // Get public key
    getNode: ['lnd', ({lnd}, cbk) => getWalletInfo({lnd}, cbk)],

    // Paths
    paths: [
      'decodeRequest',
      'getChannels',
      'getGraph',
      'getNode',
      ({decodeRequest, getChannels, getGraph, getNode}, cbk) =>
    {
      const privateNodes = getGraph.nodes.filter(({sockets}) => {
        return !sockets.length || !sockets.find(n => !/onion:/.test(n));
      });

      const lowLiquidity = getChannels.channels
        .filter(n => n.local_balance < decodeRequest.tokens)
        .map(n => n.id);

      const privateChannels = getGraph.channels.filter(({id, policies}) => {
        if (lowLiquidity.find(n => n === id)) {
          return false;
        }

        if (policies.find(n => !n.base_fee_mtokens)) {
          return false;
        }

        return !!policies.find(policy => {
          if (policy.public_key === getNode.public_key) {
            return true;
          }

          if (policy.public_key === decodeRequest.destination) {
            return true;
          }

          return !!privateNodes.find(n => n.public_key === policy.public_key);
        });
      });

      try {
        const {paths} = calculatePaths({
          channels: privateChannels,
          end: decodeRequest.destination,
          mtokens: decodeRequest.mtokens,
          start: getNode.public_key,
        });

        if (!paths || !paths.length) {
          return cbk([503, 'FailedToFindPathToDestination']);
        }

        return cbk(null, paths);
      } catch (err) {
        return cbk([500, 'FailedToCalculatePaths', err]);
      }
    }],

    // Get current height
    getHeight: ['lnd', 'paths', ({lnd}, cbk) => getWalletInfo({lnd}, cbk)],

    // Find a working route
    findRoute: [
      'decodeRequest',
      'getHeight',
      'lnd',
      'paths',
      ({decodeRequest, getHeight, lnd, paths}, cbk) =>
    {
      const height = getHeight.current_block_height;
      const {mtokens} = decodeRequest;
      const {tokens} = decodeRequest;

      return probe({
        lnd,
        tokens,
        routes: paths.map(({hops}) => routeFromHops({height, hops, mtokens})),
      },
      cbk);
    }],

    // Pay the working route
    payRoute: [
      'decodeRequest',
      'findRoute',
      'lnd',
      ({decodeRequest, findRoute, lnd}, cbk) =>
    {
      const {id} = decodeRequest;
      const {route} = findRoute;

      return pay({lnd, path: {id, routes: [route]}}, cbk);
    }],
  },
  returnResult({of: 'payRoute'}, cbk));
};
