const flatten = arr => [].concat(...arr);
const uniq = arr => Array.from(new Set(arr));

/** Calculate multi-probe adjustments

  Treat all hops except the first as already used, so as not to overlap on
  subsequent probes.

  Every probe success on a peer will draw down budgets of their channels.

  The caller can check on these budgets to decide if it's time to move on to
  another public key, due to lack of budget.

  {
    channels: [{
      id: <Standard Format Channel Id String>
      local_balance: <Local Balance Tokens Number>
      local_reserve: <Local Reserve Tokens Number>
      partner_public_key: <Public Key Hex String>
    }]
    from: <From Public Key Hex String>
    ignore: [{
      from_public_key: <Public Key Hex String>
      [to_public_key]: <To Public Key Hex String>
    }]
    probes: [{
      latency_ms: <Latency Milliseconds Number>
      relays: [<Public Key Hex String>]
      route_maximum: <Route Maximum Number>
    }]
    routes: [{
      public_key: <Hop Public Key Hex String>
    }]
    tokens: <Starting Tokens Number>
  }

  @throws
  <Error>

  @returns
  {
    ignore: [{
      from_public_key: <Public Key Hex String>
      [to_public_key]: <To Public Key Hex String>
    }]
  }
*/
module.exports = ({channels, from, ignore, probes, tokens}) => {
  const msSpent = probes.reduce((sum, n) => sum + n.latency_ms, Number());

  const pairs = probes.map(probe => {
    const [out, ...network] = probe.relays.map((to, i, arr) => {
      return {from_public_key: arr[--i] || from, to_public_key: to};
    });

    return {network, out: out.to_public_key, used: probe.route_maximum};
  });

  const outPeers = uniq(pairs.map(n => n.out));

  const exhausted = outPeers.filter(out => {
    const used = pairs.filter(n => n.out === out).map(n => n.used);

    const available = channels
      .filter(n => n.partner_public_key === out)
      .map(n => n.local_balance - n.local_reserve)
      .filter(n => n > tokens);

    used.forEach(amount => {
      const channel = available.findIndex(n => n > amount);

      return available[channel] -= amount;
    });

    return !available.find(n => n > tokens);
  });

  const exhaustedIgnores = exhausted.map(to => ({
    from_public_key: from,
    to_public_key: to,
  }));

  const networkIgnores = flatten(pairs.map(n => n.network));

  return {
    ignore: [].concat(ignore).concat(exhaustedIgnores).concat(networkIgnores),
  };
};
