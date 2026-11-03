const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {formatTokens} = require('ln-sync');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const executeProbe = require('./execute_probe');
const getOutChannels = require('./get_out_channels');

const asBtc = n => formatTokens({tokens: n}).display.trim() || (0).toFixed(8);
const maxShownPeers = 6;
const mtokensAsTokens = n => Number(BigInt(n) / BigInt(1e3));

/** Get a route for a payment of a stream by probing for it

  {
    cltv_delta: <Final CLTV Delta Number>
    destination: <Destination Public Key Hex String>
    [features]: [{
      bit: <Feature Bit Number>
    }]
    [filters]: [<Out Through Peer Filter Formula String>]
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
    ignore: [{
      from_public_key: <Avoid Node With Public Key Hex String>
      [to_public_key]: <Avoid Routing To Node With Public Key Hex String>
    }]
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    max_fee_mtokens: <Max Fee Millitokens String>
    mtokens: <Probe Millitokens String>
    out: [<Out Through Peer With Public Key, Alias, or Tag String>]
    payment: <Payment Identifier Hex String>
    [routes]: [[{
      [base_fee_mtokens]: <Base Routing Fee In Millitokens String>
      [channel]: <Standard Format Channel Id String>
      [cltv_delta]: <CLTV Blocks Delta Number>
      [fee_rate]: <Fee Rate In Millitokens Per Million Number>
      public_key: <Forward Edge Public Key Hex String>
    }]]
    [tagged]: [{
      icons: [<Icon String>]
      public_key: <Public Key Hex String>
    }]
  }

  @returns via cbk or Promise
  {
    [route]: <Route Object>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetStreamRoute']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedLoggerToGetStreamRoute']);
        }

        if (!args.mtokens) {
          return cbk([400, 'ExpectedMillitokensToGetStreamRoute']);
        }

        return cbk();
      },

      // Find the channels to pay out through
      getOuts: ['validate', ({}, cbk) => {
        return getOutChannels({
          filters: args.filters,
          fs: args.fs,
          lnd: args.lnd,
          out: args.out,
        },
        cbk);
      }],

      // Probe for a route
      probe: ['getOuts', ({getOuts}, cbk) => {
        return executeProbe({
          cltv_delta: args.cltv_delta,
          destination: args.destination,
          features: args.features,
          ignore: args.ignore,
          is_strict_max_fee: true,
          lnd: args.lnd,
          logger: args.logger,
          max_fee_mtokens: args.max_fee_mtokens,
          mtokens: args.mtokens,
          outgoing_channels: getOuts.channels,
          payment: args.payment,
          routes: args.routes,
          tagged: args.tagged,
        },
        cbk);
      }],

      // Get the aliases of the first out peers to note what was searched
      getAliases: ['getOuts', 'probe', ({getOuts, probe}, cbk) => {
        // Exit early when there is a route
        if (!!probe.route) {
          return cbk(null, []);
        }

        const shown = getOuts.public_keys.slice(Number(), maxShownPeers);

        return asyncMap(shown, (id, cbk) => {
          return getNodeAlias({id, lnd: args.lnd}, cbk);
        },
        cbk);
      }],

      // Note what was searched when there is no route
      route: [
        'getAliases',
        'getOuts',
        'probe',
        ({getAliases, getOuts, probe}, cbk) =>
      {
        // Exit early when there is a route
        if (!!probe.route) {
          return cbk(null, {route: probe.route});
        }

        const amount = formatTokens({tokens: mtokensAsTokens(args.mtokens)});
        const maxFee = mtokensAsTokens(args.max_fee_mtokens);
        const hidden = getOuts.public_keys.length - getAliases.length;
        const out = getAliases.map(n => `${n.alias} ${n.id}`.trim());

        const more = !hidden ? [] : [`and ${hidden} more`];

        args.logger.info({
          no_route_found: {
            amount: amount.display,
            max_fee: asBtc(maxFee),
            out_through: !out.length ? undefined : out.concat(more),
            routes_tried: probe.attempted_paths,
          },
        });

        return cbk(null, {});
      }],
    },
    returnResult({reject, resolve, of: 'route'}, cbk));
  });
};
