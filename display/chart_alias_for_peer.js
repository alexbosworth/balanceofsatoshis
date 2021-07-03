const disconnectedEmoji = '🚪';
const forwardingEmoji = '💸';
const inactiveEmoji = '💀';
const inboundOffEmoji = '🚫'
const isEmoji = /[^\p{L}\p{N}\p{P}\p{Z}{\^\$}]/gu;
const maxDowntime = 10;
const pendingEmoji = '⏳';
const privateEmoji = '🌚'
const separator = ' ';
const shortKey = key => key.substring(0, 16);
const thawingEmoji = '🧊';
const unreliableEmoji = '🤢';

/** Display a chart alias for a peer

  {
    alias: <Alias String>
    [downtime_percentage]: <Percentage Of Time Peer Is Down Number>
    [icons]: [<Icon String>]
    [is_disconnected]: <Peer is No Longer Connected By Any Channel Bool>
    [is_forwarding]: <Peer is Forwarding Bool>
    [is_inbound_disabled]: <Peer Inbound Disabled Bool>
    [is_inactive]: <Peer Channels Are Disabled Bool>
    [is_pending]: <Peer Has Pending Liquidity Bool>
    [is_private]: <Peer is Privately Connected Bool>
    [is_thawing]: <Peer Channel is Coop Close Restricted Bool>
    public_key: <Node Identity Public Key Hex String>
  }

  @returns
  {
    display: <Chart Alias String>
  }
*/
module.exports = args => {
  const downtime = args.downtime_percentage;
  const forwarding = !!args.is_forwarding ? forwardingEmoji : String();
  const inactive = !!args.is_inactive ?  inactiveEmoji : String();
  const inboundOff = !!args.is_inbound_disabled ? inboundOffEmoji : String();
  const isPrivate = !!args.is_private;
  const left = !!args.is_disconnected ? disconnectedEmoji : String();
  const pendingLiquidity = !!args.is_pending ? pendingEmoji : String();
  const privatePeer = !!args.is_private ? privateEmoji : String();
  const regularAlias = args.alias.replace(isEmoji, String()).trim();
  const thawing = !!args.is_thawing ? thawingEmoji : String();

  const handle = regularAlias || shortKey(args.public_key);
  const highDowntime = !!downtime && downtime > maxDowntime;

  const isOftenDown = !isPrivate && !inactive && !!highDowntime;

  const unreliable = !!isOftenDown ? unreliableEmoji : String();

  const markers = []
    .concat(!args.icons ? [] : args.icons)
    .concat([
      left,
      inactive,
      inboundOff,
      forwarding,
      pendingLiquidity,
      privatePeer,
      thawing,
      unreliable,
    ]);

  return {display: markers.concat(handle).filter(n => !!n).join(separator)};
};
