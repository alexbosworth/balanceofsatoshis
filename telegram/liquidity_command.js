const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const checkAccess = require('./check_access');
const {findKey} = require('./../peers');
const {formatTokens} = require('./../display');
const {getLiquidity} = require('./../balances');
const {getNodeAlias} = require('./../peers');
const interaction = require('./interaction');
const sendMessage = require('./send_message');

const uniq = arr => Array.from(new Set(arr));

/** Check peer liquidity

  Syntax of command:

  /liquidity <peer>

  {
    from: <Command From User Id Number>
    id: <Connected User Id Number>
    key: <Telegram API Key String>
    nodes: [{
      from: <From Name String>
      lnd: <Authenticated LND API Object>
      public_key: <Public Key Hex String>
    }]
    reply: <Reply Function>
    request: <Request Function>
    text: <Original Command Text String>
  }
*/
module.exports = ({from, id, key, nodes, reply, request, text}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!from) {
          return cbk([400, 'ExpectedFromUserIdNumberForLiquidityCommand']);
        }

        if (!id) {
          return cbk([400, 'ExpectedConnectedIdNumberForLiquidityCommand']);
        }

        if (!key) {
          return cbk([400, 'ExpectedTelegramApiKeyForLiquidityCommand']);
        }

        if (!reply) {
          return cbk([400, 'ExpectedReplyFunctionForLiquidityCommand']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionForLiquidityCommand']);
        }

        if (!text) {
          return cbk([400, 'ExpectedOriginalCommandTextForLiquidityCommand']);
        }

        return cbk();
      },

      // Authenticate the command caller is authorized to this command
      checkAccess: ['validate', ({}, cbk) => {
        return checkAccess({from, id, reply}, cbk);
      }],

      // Derive the query if present
      query: ['checkAccess', ({}, cbk) => {
        const [, query] = text.split(' ');

        return cbk(null, query);
      }],

      // Get public key filter
      getKey: ['query', ({query}, cbk) => {
        if (!query) {
          return cbk();
        }

        return asyncMap(nodes, (node, cbk) => {
          return getChannels({lnd: node.lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return findKey({
              query,
              channels: res.channels,
              lnd: node.lnd,
            },
            (err, found) => {
              if (!!err) {
                return cbk();
              }

              return cbk(null, found.public_key);
            });
          });
        },
        cbk);
      }],

      // Liquidity with peer
      withPeer: ['getKey', ({getKey}, cbk) => {
        if (!getKey) {
          return cbk();
        }

        const [withPeer, other] = uniq(getKey.filter(n => !!n));

        if (!withPeer || !!other) {
          sendMessage({
            id,
            key,
            request,
            text: interaction.peer_not_found,
          },
          err => {});

          return cbk([404, 'FailedToFindPeerMatch']);
        }

        return cbk(null, withPeer);
      }],

      // Fetch inbound liquidity information
      getInboundLiquidity: ['withPeer', ({withPeer}, cbk) => {
        return asyncMap(nodes, (node, cbk) => {
          return getLiquidity({lnd: node.lnd, with: withPeer}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {
              balance: res.balance,
              public_key: node.public_key,
            });
          });
        },
        cbk);
      }],

      // Fetch outbound liquidity information
      getOutboundLiquidity: ['withPeer', ({withPeer}, cbk) => {
        return asyncMap(nodes, (node, cbk) => {
          return getLiquidity({
            lnd: node.lnd,
            is_outbound: true,
            with: withPeer,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {
              balance: res.balance,
              public_key: node.public_key,
            });
          });
        },
        cbk);
      }],

      // Put together liquidity report
      liquidity: [
        'getInboundLiquidity',
        'getOutboundLiquidity',
        'withPeer',
        ({getInboundLiquidity, getOutboundLiquidity, withPeer}, cbk) =>
      {
        const report = nodes.map(node => {
          const inbound = getInboundLiquidity
            .find(n => n.public_key === node.public_key);

          const outbound = getOutboundLiquidity
            .find(n => n.public_key === node.public_key);

          if (!inbound.balance && !outbound.balance) {
            return '';
          }

          const inboundFormatted = formatTokens({
            is_monochrome: true,
            tokens: inbound.balance,
          });

          const outboundFormatted = formatTokens({
            is_monochrome: true,
            tokens: outbound.balance,
          });

          const lines = [
            `🌊 ${node.from}:`,
            !inbound.balance ? '' : `Inbound: ${inboundFormatted.display}`,
            !outbound.balance ? '' : `Outbound: ${outboundFormatted.display}`,
          ];

          return lines.filter(n => !!n).join('\n');
        });

        sendMessage({id, key, request, text: report.join('\n\n')}, err => {});

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
