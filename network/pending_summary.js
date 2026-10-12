const {bold} = require('colorette');
const {formatTokens} = require('ln-sync');

const {formatDuration} = require('./../display');

const blocksAsMs = blocks => blocks * 1000 * 60 * 10;
const flatten = arr => [].concat(...arr);
const isEmoji = /[^\p{L}\p{N}\p{P}\p{Z}{\^\$}]/gu;
const joinLines = lines => lines.join('\n');
const joinPath = hops => hops.join(' → ');
const joinSections = sections => sections.join('\n\n');
const moreHops = count => `...${count} more...`;
const nothingPending = 'No pending payments or channels';
const shortKey = key => key.substring(0, 8);

/** Summarize the pending channels and in-flight HTLCs of nodes

  {
    [is_monochrome]: <Mute Colors Bool>
    [max_relays]: <Maximum Relaying Peers of a Path to Show Number>
    nodes: [{
      closing: [{
        [blocks_until_recovery]: <Blocks Until Pending Balance Recovers Number>
        [close_transaction_id]: <Closing Transaction Id Hex String>
        [peer_alias]: <Peer Alias String>
        peer_public_key: <Peer Public Key Hex String>
        [pending_balance]: <Pending Recovery Tokens Number>
      }]
      forwarding: [{
        fee: <Routing Fee Tokens Number>
        [in_peer_alias]: <Inbound Peer Alias String>
        in_peer_public_key: <Inbound Peer Public Key Hex String>
        [out_peer_alias]: <Outbound Peer Alias String>
        out_peer_public_key: <Outbound Peer Public Key Hex String>
        tokens: <Forwarding Tokens Number>
      }]
      opening: [{
        capacity: <Channel Capacity Tokens Number>
        is_partner_initiated: <Peer Is Opening The Channel Bool>
        [peer_alias]: <Peer Alias String>
        peer_public_key: <Peer Public Key Hex String>
        transaction_id: <Funding Transaction Id Hex String>
      }]
      sending: [{
        [fee]: <Routing Fee Tokens Number>
        hops: [{
          [alias]: <Hop Node Alias String>
          public_key: <Hop Node Public Key Hex String>
        }]
        is_rebalance: <Payment Is Going Back To The Node Itself Bool>
        tokens: <Sending Tokens Number>
      }]
      [alias]: <Node Alias String>
      public_key: <Node Identity Public Key Hex String>
    }]
    [tagged]: [{
      icons: [<Icon String>]
      public_key: <Public Key Hex String>
    }]
  }

  @returns
  {
    summary: <Pending Items Summary String>
  }
*/
module.exports = args => {
  // Zero or absent tokens have no amount to display
  const amount = tokens => {
    const {display} = formatTokens({
      tokens,
      is_monochrome: args.is_monochrome,
    });

    return display.trim();
  };

  // Paths may collapse their relaying peers to keep the path short
  const path = hops => {
    const [first, ...others] = hops;

    const [last, ...reversedRelays] = others.slice().reverse();

    const relays = reversedRelays.reverse();

    // Exit early when there is no limit or the relays are within the limit
    if (args.max_relays === undefined || !others.length) {
      return joinPath(hops);
    }

    if (relays.length <= args.max_relays) {
      return joinPath(hops);
    }

    const shown = relays.slice(Number(), args.max_relays);

    const hidden = [moreHops(relays.length - shown.length)];

    return joinPath([first].concat(shown).concat(hidden).concat(last));
  };

  // Nodes are named with their alias and a short key
  const named = (alias, key) => {
    return [alias, shortKey(key)].filter(n => !!n).join(' ');
  };

  // Other nodes are named with their tag icons and no emojis of their own
  const peer = (alias, key) => {
    const regularAlias = (alias || String()).replace(isEmoji, String()).trim();
    const tags = (args.tagged || []).find(n => n.public_key === key);

    const icons = !tags ? [] : tags.icons;

    return [].concat(icons).concat(named(regularAlias, key)).join(' ');
  };

  const sections = args.nodes.map(node => {
    // Channels that are waiting for their funding transaction to confirm
    const opening = node.opening.map(channel => {
      const direction = !channel.is_partner_initiated ? 'outbound' : 'inbound';
      const size = amount(channel.capacity);
      const tx = channel.transaction_id;
      const withPeer = peer(channel.peer_alias, channel.peer_public_key);

      const action = `${direction} ${size} channel with ${withPeer}`;

      return `Waiting for ${action} to confirm: ${tx}`;
    });

    // Channels that are closing, waiting on a timelock or on confirmation
    const closing = node.closing.map(channel => {
      const blocks = channel.blocks_until_recovery;
      const funds = amount(channel.pending_balance);
      const tx = channel.close_transaction_id;
      const withPeer = peer(channel.peer_alias, channel.peer_public_key);

      // Exit early when the funds are timelocked for some blocks
      if (!!blocks && !!funds) {
        const wait = formatDuration({ms: blocksAsMs(blocks)}).display;

        const action = `recover ${funds} in ${wait} from closing channel`;

        return `Waiting to ${action} with ${withPeer}`;
      }

      const confirm = !tx ? String() : `: ${tx}`;
      const recover = `recover ${funds} from closing channel`;

      const action = !funds ? 'close channel' : recover;

      return `Waiting to ${action} with ${withPeer}${confirm}`;
    });

    // HTLCs that are being relayed from one peer to another
    const forwarding = node.forwarding.map(forward => {
      const fee = !forward.fee ? String() : ` for ${amount(forward.fee)} fee`;
      const from = peer(forward.in_peer_alias, forward.in_peer_public_key);
      const to = peer(forward.out_peer_alias, forward.out_peer_public_key);
      const tokens = amount(forward.tokens);

      return `Forwarding ${tokens}${fee} from ${from} to ${to}`;
    });

    // Payments or probes that are going out along a path of peers
    const sending = node.sending.map(payment => {
      const fee = !payment.fee ? String() : ` for ${amount(payment.fee)} fee`;
      const hops = payment.hops.map(hop => peer(hop.alias, hop.public_key));
      const tokens = amount(payment.tokens);

      // Exit early when the payment is a rebalance that comes back to self
      if (!!payment.is_rebalance) {
        // The final hop of a rebalance is the node itself and not a peer
        const [ownNode, ...route] = hops.slice().reverse();

        return `Rebalancing ${tokens}${fee} out ${path(route.reverse())}`;
      }

      return `Probing ${tokens}${fee} out ${path(hops)}`;
    });

    // Sections go from the slowest to change to the fastest to change
    return {
      lines: flatten([closing, opening, forwarding, sending]),
      title: named(node.alias, node.public_key),
    };
  });

  const pending = sections.filter(n => !!n.lines.length);

  // Exit early when there is nothing pending on any node
  if (!pending.length) {
    return {summary: nothingPending};
  }

  // Exit early when there is a single node, there is no need for a title
  if (args.nodes.length === [args.nodes].length) {
    const [node] = pending;

    return {summary: joinLines(node.lines)};
  }

  const titled = pending.map(node => {
    const title = !!args.is_monochrome ? node.title : bold(node.title);

    return joinLines([title].concat(node.lines));
  });

  return {summary: joinSections(titled)};
};
