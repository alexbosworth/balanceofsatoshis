const asyncAuto = require('async/auto');
const {bolden} = require('html2unicode');
const {decodeChanId} = require('bolt07');
const {getAutopilot} = require('ln-service');
const {getBackups} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {getChannels} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getInvoices} = require('ln-service');
const {getNetworkGraph} = require('ln-service');
const {getPayments} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {italicize} = require('html2unicode');
const moment = require('moment');
const {parsePaymentRequest} = require('ln-service');
const request = require('request');
const {returnResult} = require('asyncjs-util');

const {authenticatedLnd} = require('./../lnd');
const {currencyForNetwork} = require('./../network');
const {getBalance} = require('./../balances');
const {getCoindeskCurrentPrice} = require('./../fiat');
const {getForwards} = require('./../network');

const afterMs = 1000 * 60 * 60 * 24;
const centsPerDollar = 100;
const defaultConfTarget = 6;
const formatAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const msPerBlock = 1000 * 60 * 10;
const {now} = Date;
const sumOf = arr => arr.reduce((sum, n) => n + sum, 0);
const styled = 'styled';

/** Get report

  {
    [node]: <Node Name String>
    [style]: <Style Type String>
  }

  @returns via cbk
  {}
*/
module.exports = ({node, style}, cbk) => {
  return asyncAuto({
    // Get authenticated lnd connection
    getLnd: cbk => authenticatedLnd({node}, cbk),

    // Get exchange rate
    getRate: cbk => {
      return getCoindeskCurrentPrice({
        request,
        currency: 'BTC',
        fiat: 'USD',
      },
      cbk);
    },

    // Get balance
    getBalance: ['getLnd', ({getLnd}, cbk) => {
      return getBalance({node, lnd: getLnd.lnd}, cbk);
    }],

    // Get forwards
    getForwards: ['getLnd', ({getLnd}, cbk) => {
      return getForwards({lnd: getLnd.lnd}, cbk);
    }],

    // Get autopilot status
    getAutopilot: ['getLnd', ({getLnd}, cbk) => {
      return getAutopilot({lnd: getLnd.lnd}, (err, res) => {
        if (!!err) {
          return cbk(null, {});
        }

        return cbk(null, res);
      });
    }],

    // Get backups
    getBackups: ['getLnd', ({getLnd}, cbk) => {
      return getBackups({lnd: getLnd.lnd}, cbk);
    }],

    // Get channels
    getChannels: ['getLnd', ({getLnd}, cbk) => {
      return getChannels({lnd: getLnd.lnd}, cbk);
    }],

    // Get closed channels
    getClosed: ['getLnd', ({getLnd}, cbk) => {
      return getClosedChannels({lnd: getLnd.lnd}, cbk);
    }],

    // Get chain fee rate
    getChainFee: ['getLnd', ({getLnd}, cbk) => {
      return getChainFeeRate({
        lnd: getLnd.lnd,
        confirmation_target: defaultConfTarget,
      },
      (err, res) => {
        if (!!err) {
          return cbk();
        }

        return cbk(null, res);
      });
    }],

    // Get network graph
    getGraph: ['getLnd', ({getLnd}, cbk) => {
      return getNetworkGraph({lnd: getLnd.lnd}, cbk);
    }],

    // Get wallet info
    getInfo: ['getLnd', ({getLnd}, cbk) => {
      return getWalletInfo({lnd: getLnd.lnd}, cbk);
    }],

    // Get invoices
    getInvoices: ['getLnd', ({getLnd}, cbk) => {
      return getInvoices({lnd: getLnd.lnd}, cbk);
    }],

    // Get payments
    getPayments: ['getLnd', ({getLnd}, cbk) => {
      return getPayments({lnd: getLnd.lnd}, cbk);
    }],

    // Currency
    currency: ['getInfo', ({getInfo}, cbk) => {
      const {currency} = currencyForNetwork({chains: getInfo.chains});

      return cbk(null, currency);
    }],

    report: [
      'currency',
      'getAutopilot',
      'getBackups',
      'getBalance',
      'getChainFee',
      'getChannels',
      'getForwards',
      'getGraph',
      'getInfo',
      'getInvoices',
      'getPayments',
      'getRate',
      ({
        currency,
        getAutopilot,
        getBackups,
        getBalance,
        getChainFee,
        getChannels,
        getClosed,
        getForwards,
        getGraph,
        getInfo,
        getInvoices,
        getPayments,
        getRate,
      }, cbk) =>
    {
      const activity = [];
      const balance = formatAsBigUnit(getBalance.balance);
      const channelBalance = getBalance.channel_balance;
      const currentHeight = getInfo.current_block_height;
      const {nodes} = getGraph;
      const rate = getRate.cents;
      const totalBalance = getBalance.balance;

      const fiatBalance = (balance * rate / centsPerDollar).toFixed(2);
      const findNode = pk => nodes.find(n => n.public_key === pk) || {};
      const lightningFunds = (channelBalance / totalBalance * 100).toFixed();

      const report = [
        {subtitle: 'current status', title: 'Node'},
        {details: getInfo.public_key},
        {details: getInfo.alias},
        {details: `${balance} ${currency} ($${fiatBalance})`},
        {details: `1 ${currency}~$${(rate / 100).toFixed(2)}`},
        {},
        {
          is_hidden: !getAutopilot.is_enabled,
          subtitle: 'Enabled',
          title: 'Autopilot:',
        },
        {
          subtitle: moment(getInfo.latest_block_at).fromNow(),
          title: 'Last Block:',
        },
        {
          subtitle: `${lightningFunds}%`,
          title: 'Funds on Lightning',
        },
      ];

      if (!!getChainFee) {
        report.push({
          subtitle: `${getChainFee.tokens_per_vbyte} sat/vbyte`,
          title: 'Confirmation Fee:',
        });
      }

      getChannels.channels.slice().reverse()
        .filter(({id}) => {
          const chanHeight = decodeChanId({channel: id}).block_height;

          return getInfo.current_block_height - chanHeight < 144;
        })
        .forEach(channel => {
          const chanId = channel.id;
          const elements = [];
          const pubKey = channel.partner_public_key;

          const {backup} = getBackups.channels.find(chan => {
            if (chan.transaction_id !== channel.transaction_id) {
              return false;
            }

            return chan.transaction_vout === channel.transaction_vout;
          });

          const channels = getChannels.channels.filter(chan => {
            return chan.partner_public_key === channel.partner_public_key
          });

          const chanBlockHeight = decodeChanId({channel: chanId}).block_height;

          const blocksSinceOpen = currentHeight - chanBlockHeight;

          const date = moment(now() - blocksSinceOpen * msPerBlock);
          const node = getGraph.nodes.find(n => n.public_key === pubKey) || {};

          elements.push({
            subtitle: date.fromNow(),
            title: node.alias || channel.partner_public_key,
          });

          elements.push({action: 'Opened channel'});

          const localBalances = channels.map(n => n.local_balance);
          const remoteBalances = channels.map(n => n.remote_balance);

          const inbound = (sumOf(remoteBalances) / 1e8).toFixed(8);
          const outbound = (sumOf(localBalances) / 1e8).toFixed(8);

          const inboundLiquid = `${inbound} ${currency} inbound`;
          const outboundLiquid = `${outbound} ${currency} outbound`;

          elements.push({
            details: `Liquidity now ${inboundLiquid}, ${outboundLiquid}`,
          });

          const utxo = `${channel.transaction_id}:${channel.transaction_vout}`;

          elements.push({details: `Backup: ${utxo} ${backup}`});

          return activity.push({elements, date: date.toISOString()});
        });

      getInvoices.invoices.slice().reverse()
        .filter(invoice => !!invoice.confirmed_at)
        .filter(invoice => now() - Date.parse(invoice.confirmed_at) < afterMs)
        .forEach(invoice => {
          const elements = [];
          const received = invoice.received;

          elements.push({
            subtitle: moment(invoice.confirmed_at).fromNow(),
            title: getInfo.alias || getInfo.public_key,
          });

          elements.push({
            action: 'Received payment',
          });

          elements.push({
            details: `"${invoice.description}"`,
          });

          elements.push({
            details: `Received: ${formatAsBigUnit(received)} ${currency}`,
          });

          return activity.push({elements, date: invoice.confirmed_at});
        });

      getPayments.payments.slice().reverse()
        .filter(payment => now() - Date.parse(payment.created_at) < afterMs)
        .forEach(payment => {
          const elements = [];
          const node = findNode(payment.destination);
          const {request} = payment;

          elements.push({
            subtitle: moment(payment.created_at).fromNow(),
            title: node.alias || payment.destination,
          });

          elements.push({action: 'Sent payment'});

          if (payment.request) {
            elements.push({
              details: `"${parsePaymentRequest({request}).description}"`,
            });
          }

          elements.push({
            details: `Sent: ${formatAsBigUnit(payment.tokens)} ${currency}`,
          });

          return activity.push({elements, date: payment.created_at});
        });

      getClosed.channels
        .filter(channel => currentHeight - channel.close_confirm_height < 160)
        .forEach(channel => {
          const closeHeight = channel.close_confirm_height;
          const node = findNode(channel.partner_public_key);

          const msSinceClose = (currentHeight - closeHeight) * msPerBlock;

          const channels = getChannels.channels
            .filter(n => n.partner_public_key === channel.partner_public_key);

          const elements = [];

          const date = moment(now() - msSinceClose);

          elements.push({
            subtitle: date.fromNow(),
            title: node.alias || channel.partner_public_key,
          });

          elements.push({
            action: 'Channel closed',
          });

          const remoteBalance = channels.map(n => n.remote_balance);
          const localBalance = channels.map(n => n.local_balance);

          const inbound = formatAsBigUnit(sumOf(remoteBalance));
          const outbound = formatAsBigUnit(sumOf(localBalance));

          const inboundLiquidity = `${inbound} ${currency} inbound`;
          const outboundLiquidity = `${outbound} ${currency} outbound`;

          elements.push({
            details: `Liquidity now ${inboundLiquidity}, ${outboundLiquidity}`,
          });

          return activity.push({elements, date: date.toISOString()});
        });

      getForwards.peers.slice().reverse().forEach(peer => {
        const lastActivity = [peer.last_inbound_at, peer.last_outbound_at];
        const elements = [];

        const [last] = lastActivity.sort();

        elements.push({
          subtitle: moment(last).fromNow(),
          title: peer.alias,
        });

        elements.push({action: 'Routing activity'});

        if (!!peer.earned_inbound_fees) {
          const inbound = formatAsBigUnit(peer.earned_inbound_fees);

          elements.push({
            details: `Earned from inbound routing: ${inbound} ${currency}`,
          });
        }

        if (!!peer.earned_outbound_fees) {
          const outbound = formatAsBigUnit(peer.earned_outbound_fees);

          elements.push({
            details: `Earned from outbound routing: ${outbound} ${currency}`,
          });
        }

        const inbound = peer.liquidity_inbound;

        elements.push({
          details: `Inbound liquidity: ${inbound} ${currency}`,
        });

        const outbound = peer.liquidity_outbound;

        elements.push({
          details: `Outbound liquidity: ${outbound} ${currency}`,
        });

        return activity.push({elements, date: last});
      });

      if (!!activity.length) {
        report.push({});
        report.push({title: 'Recent Activity:'});
      }

      activity.sort((a, b) => a.date > b.date ? -1 : 1);

      activity.forEach(({elements}) => {
        report.push({});

        return elements.forEach(element => report.push(element))
      });

      const renderReport = (lines) => {
        return lines
          .filter(n => !n.is_hidden)
          .map(({action, details, subtitle, title}) => {
            const elements = [
              !!title && style === styled ? bolden(title) : title,
              subtitle,
              details,
              !!action && style === styled ? italicize(action) : action,
            ];

            return elements.filter(n => !!n).join(' ');
          })
          .join('\n');
      }

      return cbk(null, renderReport(report));
    }],
  },
  returnResult({of: 'report'}, cbk));
};
