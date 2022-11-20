const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {returnResult} = require('asyncjs-util');

const {decode} = require('bip66');

const {getPrices} = require('@alexbosworth/fiat');
const {parseAmount} = require('ln-accounting');
const {createSignedRequest} = require('invoices');
const {createUnsignedRequest} = require('invoices');
const {createInvoice} = require('ln-service');
const {getChannels} = require('ln-service');
const {getChannel} = require('ln-service');
const {getIdentity} = require('ln-service');
const {signBytes} = require('ln-service');
const {getNetwork} = require('ln-sync');

const coins = ['BTC'];
const defaultCltvDelta = 144;
const defaultFiatRateProvider = 'coingecko';
const defaultInvoiceDescription = 'payrequest';
const fiats = ['EUR', 'USD'];
const hasFiat = n => /(eur|usd)/gim.test(n);
const {isArray} = Array;
const networks = {btc: 'BTC', btctestnet: 'BTC', btcregtest: 'BTC', ltc: 'LTC'};
const rateAsTokens = rate => 1e8 / rate;
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);

/** Create an BOLT 11 payment request
  {
    amount: <Invoice Amount String>
    ask: <Inquirer Function>
    [is_including_private_channels]: <Include Private Channels Bool>
    [is_selecting_hops]: <Is Selecting Hops Bool>
    lnd: <Authenticated LND API Object>
    request: <Request Function>
  }
  @returns via cbk or Promise
  {
    request: <BOLT 11 Payment Request String>
    tokens: <Invoice Amount Number>
  }
 */
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.amount) {
          return cbk([400, 'ExpectedInvoiceAmountToCreateInvoice']);
        }

        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToCreateInvoice']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToCreateInvoice']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToCreateInvoice']);
        }

        return cbk();
      },

      // Get the current price of BTC in USD/EUR
      getFiatPrice: ['validate', ({}, cbk) => {
        // Exit early when no fiat is referenced
        if (!hasFiat(args.amount)) {
          return cbk();
        }

        return getPrices({
          from: defaultFiatRateProvider,
          request: args.request,
          symbols: [].concat(coins).concat(fiats),
        },
        cbk);
      }],

      // Get channels
      getChannels: ['validate', ({}, cbk) => getChannels({lnd: args.lnd, is_active: true, is_private: true}, cbk)],

      // Get network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Get wallet info
      getIdentity: ['validate', ({}, cbk) => getIdentity({lnd: args.lnd}, cbk)],

      // Fiat rates
      fiatRates: [
        'getFiatPrice',
        'getNetwork',
        ({getFiatPrice, getNetwork}, cbk) =>
      {
        // Exit early when there is no fiat
        if (!getFiatPrice) {
          return cbk();
        }

        const coin = getFiatPrice.tickers.find(({ticker}) => {
          return ticker === networks[getNetwork.network];
        });
        
        const rates = fiats.map(fiat => {
          const {rate} = getFiatPrice.tickers.find(n => n.ticker === fiat);
          return {fiat, unit: rateAsTokens(rate) * coin.rate};
        });
        
        return cbk(null, rates);
      }],

      // Parse amount
      parseAmount: [
        'fiatRates',
        ({fiatRates}, cbk) => {
          const eur = !!fiatRates ? fiatRates.find(n => n.fiat === 'EUR') : null;
          const usd = !!fiatRates ? fiatRates.find(n => n.fiat === 'USD') : null;
  
          // Variables to use in amount
          const variables = {
            eur: !!eur ? eur.unit : undefined,
            usd: !!usd ? usd.unit : undefined,
          };
          
          try {
            const {tokens} = parseAmount({variables, amount: args.amount});

            return cbk(null, {tokens});
          } catch (err) {
            return cbk([500, 'FailedToParseAmount', {err}]);
          }
        }
      ],

      // Select hop hint channels
      selectChannels: [
        'getChannels',
        'parseAmount',
        ({getChannels}, cbk) => {
          // Exit early if not selecting channels
          if (!args.is_selecting_hops) {
            return cbk();
          }

          return args.ask({
            choices: getChannels.channels.map(channel => {
              const value = channel.id;
              const inbound = `in: ${tokensAsBigUnit(channel.remote_balance)}`;
              const outbound = `out: ${tokensAsBigUnit(channel.local_balance)}`;

              return {
                value,
                name: `${value}: ${inbound} | ${outbound}.`,
              };
            }),
            loop: false,
            message: `Channels to include in invoice?`,
            name: 'id',
            type: 'checkbox',
            validate: input => !!input.length,
          },
          ({id}) => cbk(null, id));
        }
      ],

      // Get the policies of selected channels
      getPolicies: ['selectChannels', ({selectChannels}, cbk) => {
        return asyncMap(selectChannels, (channel, cbk) => {
          return getChannel({id: channel, lnd: args.lnd}, (err, res) => {
            if (isArray(err) && err.slice().shift() === 404) {
              return cbk();
            }

            if (!!err) {
              return cbk(err);
            }

            // Exit early when the channel policies are not defined
            if (!!res.policies.find(n => n.cltv_delta === undefined)) {
              return cbk();
            }

            return cbk(null, res);
          });
        },
        cbk);
      }],

      // Create invoice
      addInvoice: [
        'getPolicies',
        'parseAmount',
        ({parseAmount}, cbk) => {
          return createInvoice({
            lnd: args.lnd,
            tokens: parseAmount.tokens,
            description: defaultInvoiceDescription,
            is_including_private_channels: !!args.is_including_private_channels ? true : undefined,
          },
          cbk);
        }
      ],

      // Register custom invoice
      registerInvoice: [
        'addInvoice',
        'getIdentity',
        'getNetwork',
        'getPolicies',
        'parseAmount',
        'selectChannels',
        async ({addInvoice, getIdentity, getNetwork, getPolicies, parseAmount}) => {
          // Exit early if not selecting hops
          if (!args.is_selecting_hops) {
            return {
              request: addInvoice.request,
              tokens: addInvoice.tokens,
            };
          }

          const routes = [];

          const policies = getPolicies.filter(n => !!n);

          policies.forEach(n => {
            const peerPolicy = n.policies.find(n => n.public_key !== getIdentity.public_key);

            if (!!peerPolicy) {
              routes.push([
                {
                  public_key: peerPolicy.public_key,
                },
                {
                base_fee_mtokens: peerPolicy.base_fee_mtokens,
                channel: n.id,
                cltv_delta: peerPolicy.cltv_delta,
                fee_rate: peerPolicy.fee_rate,
                public_key: getIdentity.public_key,
              }
            ]);
            }
          });

          const {tokens} = parseAmount;

          const unsigned = createUnsignedRequest({
            tokens,
            cltv_delta: defaultCltvDelta,
            description: defaultInvoiceDescription,
            destination: getIdentity.public_key,
            id: addInvoice.id,
            network: getNetwork.bitcoinjs,
            payment: addInvoice.payment,
            routes: !!routes.length ? routes : undefined,
          });

          const {signature} = await signBytes({
            key_family: 6,
            key_index: 0,
            lnd: args.lnd,
            preimage: unsigned.preimage,
          });

          const {r, s} = decode(Buffer.from(signature, 'hex'));

          const rValue = r.length === 33 ? r.slice(1) : r;

          const {request} = createSignedRequest({
            destination: getIdentity.public_key,
            hrp: unsigned.hrp,
            signature: Buffer.concat([rValue, s]).toString('hex'),
            tags: unsigned.tags,
          });
          
          return {
            request,
            tokens: addInvoice.tokens,
          };
        }
      ],
    },
    returnResult({reject, resolve, of: 'registerInvoice'}, cbk));
  });
};
