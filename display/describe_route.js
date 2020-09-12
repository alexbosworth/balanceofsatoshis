const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getNode} = require('ln-service');
const {green} = require('colorette');
const {returnResult} = require('asyncjs-util');

const describeConfidence = require('./describe_confidence');
const formatFeeRate = require('./format_fee_rate');

const effectiveFeeRate = (n, m) => Number(BigInt(1e6) * BigInt(n) / BigInt(m));
const flatten = arr => [].concat(...arr);

/** Describe a route

  {
    lnd: <Authenticated LND API Object>
    route: {
      [confidence]: <Route Confidence Score Out Of One Million Number>
      fee: <Total Fee Tokens To Pay Number>
      fee_mtokens: <Total Fee Millitokens To Pay String>
      hops: [{
        channel: <Standard Format Channel Id String>
        channel_capacity: <Channel Capacity Tokens Number>
        fee: <Fee Number>
        fee_mtokens: <Fee Millitokens String>
        forward: <Forward Tokens Number>
        forward_mtokens: <Forward Millitokens String>
        public_key: <Public Key Hex String>
        timeout: <Timeout Block Height Number>
      }]
      [messages]: [{
        type: <Message Type Number String>
        value: <Message Raw Value Hex Encoded String>
      }]
      mtokens: <Total Millitokens To Pay String>
      [payment]: <Payment Identifier Hex String>
      safe_fee: <Payment Forwarding Fee Rounded Up Tokens Number>
      safe_tokens: <Payment Sent Tokens Rounded Up Number>
      timeout: <Expiration Block Height Number>
      tokens: <Total Tokens To Pay Number>
      [total_mtokens]: <Total Millitokens String>
    }
  }

  @returns via cbk or Promise
  {
    description: [<Hop Description String>]
  }
*/
module.exports = ({lnd, route}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndObjectToGenerateRouteDescription']);
        }

        if (!route) {
          return cbk([400, 'ExpectedRouteToGenerateRouteDescriptionFor']);
        }

        return cbk();
      },

      // Get the node aliases
      getAliases: ['validate', ({}, cbk) => {
        return asyncMap(route.hops, (hop, cbk) => {
          return getNode({
            lnd,
            is_omitting_channels: true,
            public_key: hop.public_key,
          },
          (err, res) => {
            if (!!err) {
              return cbk(null, {alias: String(), id: hop.public_key});
            }

            return cbk(null, {alias: res.alias, id: hop.public_key});
          });
        },
        cbk);
      }],

      // Assemble the description
      description: ['getAliases', ({getAliases}, cbk) => {
        const {confidence} = route;

        const {description} = describeConfidence({confidence});

        const path = route.hops.map((hop, i, hops) => {
          const {alias} = getAliases.find(n => n.id === hop.public_key);

          const feeMtokens = !i ? hop.fee_mtokens : hops[i - 1].fee_mtokens;
          const forwarder = `${alias} ${hop.public_key}`.trim();

          const feeRate = effectiveFeeRate(feeMtokens, hop.forward_mtokens);

          const rate = formatFeeRate({rate: feeRate}).display;

          const forward = `${green(forwarder)}. Hop fee rate ${rate}`;

          if (!i) {
            return [`${hop.channel} ${description || String()}`, forward];
          } else if (i === hops.length - [i].length) {
            return [`${hop.channel}`];
          } else {
            return [`${hop.channel}`, forward];
          }
        });

        return cbk(null, {description: flatten(path)});
      }],
    },
    returnResult({reject, resolve, of: 'description'}, cbk));
  });
};
