const moment = require('moment');

const dollarFormat = cents => (cents / 100).toFixed(2);
const formatAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const percentFormat = n => isNaN(n) ? '0' : (n * 100).toFixed();

/** Derive report overview

  {
    alias: <Alias String>
    balance: <Tokens Balance>
    [chain_fee]: <Chain Fee Tokens Per VByte Number>
    channel_balance: <Channel Balance Number>
    currency: <Currency String>
    latest_block_at: <Last Block At ISO 8601 Date String>
    public_key: <Public Key Hex String>
    rate: <Fiat Rate Number>
  }

  @returns
  {
    report: [{
      [details]: <Details String>
      [is_hidden]: <Line Is Hidden Bool>
      [subtitle]: <Subtitle String>
      [title]: <Title String>
    }]
  }
*/
module.exports = args => {
  const balance = formatAsBigUnit(args.balance);

  const fiatBalance = dollarFormat(balance * args.rate);

  const report = [
    {
      subtitle: 'current status',
      title: 'Node',
    },
    {
      details: args.public_key,
    },
    {
      details: args.alias,
    },
    {
      details: `${balance} ${args.currency} ($${fiatBalance})`,
    },
    {
      details: `1 ${args.currency}~$${dollarFormat(args.rate)}`,
    },
    {},
    {
      subtitle: moment(args.latest_block_at).fromNow(),
      title: 'Last Block:',
    },
    {
      subtitle: `${percentFormat(args.channel_balance / args.balance)}%`,
      title: 'Funds on Lightning',
    },
  ];

  if (!!args.chain_fee) {
    report.push({
      subtitle: `${args.chain_fee} per vbyte`,
      title: 'Confirmation Fee:',
    });
  }

  return {report};
};
