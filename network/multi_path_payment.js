const {routeFromChannels} = require('ln-service');

const {sortBy} = require('./../arrays');

const {floor} = Math;
const mtokAsTok = mtokens => Number(BigInt(mtokens) / BigInt(1e3));
const tokensAsMtokens = tokens => BigInt(tokens) * BigInt(1e3);

/** Derive multiple paths to pay to a destination

  {
    channels: [{
      capacity: <Maximum Tokens Number>
      id: <Standard Format Channel Id String>
      policies: [{
        [base_fee_mtokens]: <Base Fee Millitokens String>
        [cltv_delta]: <Locktime Delta Number>
        [fee_rate]: <Fees Charged Per Million Tokens Number>
        [is_disabled]: <Channel Is Disabled Bool>
        [max_htlc_mtokens]: <Maximum HTLC Millitokens Value String>
        [min_htlc_mtokens]: <Minimum HTLC Millitokens Value String>
        public_key: <Node Public Key String>
        [updated_at]: <Edge Last Updated At ISO 8601 Date String>
      }]
      transaction_id: <Transaction Id Hex String>
      transaction_vout: <Transaction Output Index Number>
      [updated_at]: <Channel Last Updated At ISO 8601 Date String>
    }]
    [cltv_delta]: <CLTV Delta Number>
    destination: <Destination Public Key Hex String>
    height: <Current Block Height Number>
    max: <Maximum Routeable Amount Tokens Number>
    mtokens: <Millitokens To Pay String>
    probes: [{
      channels: [<Standard Format Channel Id String>]
      liquidity: <Route Liquidity Tokens Number>
    }]
  }

  @returns
  {
    routes: [{
      fee: <Total Fee Tokens To Pay Number>
      fee_mtokens: <Total Fee Millitokens To Pay String>
      hops: [{
        channel: <Standard Format Channel Id String>
        channel_capacity: <Channel Capacity Tokens Number>
        fee: <Fee Number>
        fee_mtokens: <Fee Millitokens String>
        forward: <Forward Tokens Number>
        forward_mtokens: <Forward Millitokens String>
        [public_key]: <Public Key Hex String>
        timeout: <Timeout Block Height Number>
      }]
      [messages]: [{
        type: <Message Type Number String>
        value: <Message Raw Value Hex Encoded String>
      }]
      mtokens: <Total Millitokens To Pay String>
      [payment]: <Payment Identifier Hex String>
      timeout: <Expiration Block Height Number>
      tokens: <Total Tokens To Pay Number>
      [total_mtokens]: <Total Millitokens String>
    }]
  }
*/
module.exports = args => {
  const amounts = args.probes.map(probe => {
    return floor(mtokAsTok(args.mtokens) * probe.liquidity / args.max);
  });

  const total = amounts.reduce((sum, n) => sum + n, Number());

  const remainder = BigInt(args.mtokens) - tokensAsMtokens(total);

  const routesToCreate = args.probes.map(probe => {
    return {
      channels: probe.channels.map(id => args.channels.find(n => n.id === id)),
      cltv_delta: args.cltv_delta,
      destination: args.destination,
      height: args.height,
      payment: args.payment,
      tokens: floor(mtokAsTok(args.mtokens) * probe.liquidity / args.max),
      total_mtokens: args.mtokens,
    };
  });

  const {sorted} = sortBy({array: routesToCreate, attribute: 'tokens'});

  const totalAdjusted = sorted.map((route, i) => {
    route.mtokens = tokensAsMtokens(route.tokens).toString();

    // For simplicity, only adjust the largest route, the first one
    if (!!i) {
      return route;
    }

    // Adjust the route to carry the mtokens that didn't divide evenly
    route.mtokens = (BigInt(route.mtokens) + remainder).toString();

    return route;
  });

  return {
    routes: totalAdjusted.map(path => {
      const {route} = routeFromChannels({
        channels: path.channels,
        cltv_delta: path.cltv_delta,
        destination: path.destination,
        height: path.height,
        mtokens: path.mtokens,
        payment: path.payment,
        total_mtokens: path.total_mtokens,
      });

      return route;
    }),
  };
};
