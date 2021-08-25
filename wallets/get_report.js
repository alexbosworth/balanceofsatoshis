const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {bolden} = require('@alexbosworth/html2unicode');
const {decodeChanId} = require('bolt07');
const {getAutopilot} = require('ln-service');
const {getBackups} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getInvoice} = require('ln-service');
const {getInvoices} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getNetworkGraph} = require('ln-service');
const {getPayments} = require('ln-sync');
const {getWalletInfo} = require('ln-service');
const {italicize} = require('@alexbosworth/html2unicode');
const moment = require('moment');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {authenticatedLnd} = require('./../lnd');
const channelsAsReportActivity = require('./channels_as_report_activity');
const {currencyForNetwork} = require('./../network');
const {getBalance} = require('./../balances');
const {getCoindeskCurrentPrice} = require('./../fiat');
const {getForwards} = require('./../network');
const reportOverview = require('./report_overview');

const afterMs = 1000 * 60 * 60 * 24;
const centsPerDollar = 100;
const defaultConfTarget = 6;
const formatAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const limit = 1000;
const msPerBlock = 1000 * 60 * 10;
const {now} = Date;
const sumOf = arr => arr.reduce((sum, n) => n + sum, 0);
const styled = 'styled';

/** Get report

  {
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    [node]: <Node Name String>
    request: <Request Function>
    [style]: <Style Type String>
  }

  @returns via cbk
  {}
*/
module.exports = ({fs, node, request, style}, cbk) => {
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
      return getForwards({fs, lnd: getLnd.lnd}, cbk);
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

    // Get network
    getNetwork: ['getLnd', ({getLnd}, cbk) => {
      return getNetwork({lnd: getLnd.lnd}, cbk);
    }],

    // Get payments
    getPayments: ['getLnd', ({getLnd}, cbk) => {
      return getPayments({
        limit,
        after: new Date(now() - afterMs).toISOString(),
        lnd: getLnd.lnd,
      },
      cbk);
    }],

    // Currency
    currency: ['getInfo', ({getInfo}, cbk) => {
      const {currency} = currencyForNetwork({chains: getInfo.chains});

      return cbk(null, currency);
    }],

    // Get rebalances
    getRebalances: [
      'getInfo',
      'getLnd',
      'getPayments',
      ({getInfo, getLnd, getPayments}, cbk) =>
    {
      const rebalances = getPayments.payments.slice().reverse()
        .filter(payment => now() - Date.parse(payment.created_at) < afterMs)
        .filter(payment => payment.destination === getInfo.public_key);

      return asyncMap(rebalances, (rebalance, cbk) => {
        return getInvoice({id: rebalance.id, lnd: getLnd.lnd}, (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const [outHop] = rebalance.hops;

          const [payment] = res.payments;

          if (!payment) {
            return cbk(null, {
              created_at: rebalance.created_at,
              fee: rebalance.fee,
              out_peer: outHop,
              tokens: rebalance.tokens,
            });
          }

          return getChannel({
            id: payment.in_channel,
            lnd: getLnd.lnd,
          },
          (err, channel) => {
            if (!!err) {
              return cbk(null, {
                created_at: rebalance.created_at,
                fee: rebalance.fee,
                out_peer: outHop,
                tokens: rebalance.tokens,
              });
            }

            const inPeer = channel.policies.find(policy => {
              return policy.public_key !== getInfo.public_key;
            });

            return cbk(null, {
              created_at: rebalance.created_at,
              fee: rebalance.fee,
              in_peer: inPeer.public_key,
              out_peer: outHop,
              tokens: rebalance.tokens,
            });
          });
        });
      },
      cbk);
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
      'getNetwork',
      'getPayments',
      'getRate',
      'getRebalances',
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
        getNetwork,
        getPayments,
        getRate,
        getRebalances,
      }, cbk) =>
    {
      const activity = [];
      const currentHeight = getInfo.current_block_height;
      const {nodes} = getGraph;

      const findNode = pk => nodes.find(n => n.public_key === pk) || {};

      const {report} = reportOverview({
        currency,
        alias: getInfo.alias,
        balance: getBalance.balance,
        chain_fee: !getChainFee ? undefined : getChainFee.tokens_per_vbyte,
        channel_balance: getBalance.channel_balance,
        latest_block_at: getInfo.latest_block_at,
        public_key: getInfo.public_key,
        rate: getRate.cents,
      });

      const channelsActivity = channelsAsReportActivity({
        now,
        backups: getBackups.channels,
        chain: {
          currency,
          height: getInfo.current_block_height,
          network: getNetwork.network,
        },
        channels: getChannels.channels.slice().reverse(),
        days: 1,
        nodes: getGraph.nodes,
      });

      channelsActivity.activity.forEach(n => activity.push(n));

      getInvoices.invoices.slice().reverse()
        .filter(invoice => !!invoice.confirmed_at)
        .filter(invoice => now() - Date.parse(invoice.confirmed_at) < afterMs)
        .filter(invoice => {
          const isToSelf = getPayments.payments.find(n => n.id === invoice.id);

          return !isToSelf;
        })
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
            is_hidden: !invoice.description,
            details: `"${invoice.description}"`,
          });

          elements.push({
            details: `Received: ${formatAsBigUnit(received)} ${currency}`,
          });

          return activity.push({elements, date: invoice.confirmed_at});
        });

      getRebalances.forEach(rebalance => {
          const elements = [];
          const {fee} = rebalance;
          const {tokens} = rebalance;

          const amount = `${formatAsBigUnit(tokens)} ${currency}`;

          const inHop = rebalance.in_peer;
          const outHop = rebalance.out_peer;

          const inNode = getGraph.nodes.find(n => n.public_key === inHop);
          const outNode = getGraph.nodes.find(n => n.public_key === outHop);

          const inbound = (inNode || {}).alias || (inNode || {}).public_key;
          const outbound = (outNode || {}).alias || (outNode || {}).public_key;

          elements.push({
            subtitle: moment(rebalance.created_at).fromNow(),
            title: getInfo.alias || getInfo.public_key,
          });

          elements.push({action: 'Rebalance'});

          elements.push({
            details: `Increased inbound liquidity on ${outbound} by ${amount}`,
          });

          if (!!inbound) {
            elements.push({
              details: `Decreased inbound liquidity on ${inbound}`,
            });
          }

          elements.push({
            details: `Fee: ${formatAsBigUnit(fee)} ${currency}`,
          });

          return activity.push({elements, date: rebalance.created_at});
        });

      getPayments.payments.slice().reverse()
        .filter(payment => now() - Date.parse(payment.created_at) < afterMs)
        .filter(payment => payment.destination !== getInfo.public_key)
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

          if (!!payment.fee) {
            elements.push({
              details: `Fee: ${formatAsBigUnit(payment.fee)} ${currency}`,
            });
          }

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

        const inbound = formatAsBigUnit(peer.liquidity_inbound);

        elements.push({
          details: `Inbound liquidity: ${inbound} ${currency}`,
        });

        const outbound = formatAsBigUnit(peer.liquidity_outbound);

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
