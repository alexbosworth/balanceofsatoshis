const {decodeChanId} = require('bolt07');
const moment = require('moment');

const action = 'Opened channel';
const minutesPerBlock = network => network === 'ltcmainnet' ? 10 / 4 : 10;
const minutesPerDay = 24 * 60;
const msPerMinute = 1000 * 60;
const sumOf = arr => arr.reduce((sum, n) => n + sum, 0);
const tokensAsBigToken = tokens => (tokens / 1e8).toFixed(8);

/** Channels as report elements

  {
    backups: [{
      transaction_id: <Channel Transaction Id Hex String>
      transaction_vout: <Channel Transaction Vout Number>
    }]
    chain: {
      currency: <Currency Code String>
      height: <Current Block Height Number>
      network: <Network Name String>
    }
    channels: [{
      id: <Standard Format Channel Id String>
      local_balance: <Local Balance Tokens Number>
      partner_public_key: <Partner Public Key Hex String>
      remote_balance: <Remote Balance Tokens Number>
      transaction_id: <Channel Transaction Id Hex String>
      transaction_vout: <Channel Transaction Output Index Number>
    }]
    days: <Days Number>
    nodes: [{
      alias: <Alias String>
      public_key: <Public Key Hex String>
    }]
    now: <Current Time Function>
  }

  @returns
  {
    activity: [{
      date: <Activity Date String>
      elements: [<Report Element String>]
    }]
  }
*/
module.exports = ({backups, chain, channels, days, nodes, now}) => {
  const activity = [];
  const blocks = minutesPerDay / minutesPerBlock(chain.network) * days;
  const msPerBlock = msPerMinute * minutesPerBlock(chain.network);

  channels
    .filter(({id}) => {
      return chain.height - decodeChanId({channel: id}).block_height < blocks;
    })
    .forEach(channel => {
      const chanId = channel.id;
      const elements = [];
      const pubKey = channel.partner_public_key;
      const utxo = `${channel.transaction_id}:${channel.transaction_vout}`;

      const chanBlockHeight = decodeChanId({channel: chanId}).block_height;
      const node = nodes.find(n => n.public_key === pubKey) || {};

      const blocksSinceOpen = chain.height - chanBlockHeight;
      const title = node.alias || channel.partner_public_key;

      const date = moment(now() - blocksSinceOpen * msPerBlock);

      const {backup} = backups.find(chan => {
        if (chan.transaction_id !== channel.transaction_id) {
          return false;
        }

        return chan.transaction_vout === channel.transaction_vout;
      });

      const peerChannels = channels.filter(chan => {
        return chan.partner_public_key === channel.partner_public_key
      });

      const localBalances = peerChannels.map(n => n.local_balance);
      const remoteBalances = peerChannels.map(n => n.remote_balance);

      const inbound = tokensAsBigToken(sumOf(remoteBalances));
      const outbound = tokensAsBigToken(sumOf(localBalances));

      const inboundLiquid = `${inbound} ${chain.currency} inbound`;
      const outboundLiquid = `${outbound} ${chain.currency} outbound`;

      elements.push({title, subtitle: date.from(moment(now()))});

      elements.push({action});

      elements.push({
        details: `Liquidity now ${inboundLiquid}, ${outboundLiquid}`,
      });

      elements.push({details: `Backup: ${utxo} ${backup}`});

      return activity.push({elements, date: date.toISOString()});
    });

  return {activity};
};
