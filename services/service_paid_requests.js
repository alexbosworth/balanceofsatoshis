const asyncAuto = require('async/auto');
const asyncForever = require('async/forever');
const {getIdentity} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getNodeAlias} = require('ln-sync');
const {servicePaidRequests} = require('paid-services');

const {authenticatedLnd} = require('./../lnd');

const asFlag = n => !!n ? '1' : '0';
const mtokAsBig = n => (Number(BigInt(n) / BigInt(1e3)) / 1e8).toFixed(8);
const restartDelayMs = 1000 * 30;

/** Service KeySend payment requests

  {
    [activity_fees]: <Share Routing Activity Fees Earned Bool>
    [activity_volume]: <Share Routing Activity Total Routed Bool>
    fetch: <Fetch Function>
    [inbox_email_from]: <Inbox Email From Address String>
    [inbox_email_to]: <Inbox Email To Address String>
    [inbox_postmark_api_key]: <Inbox Postmark API Key String>
    [inbox_price]: <Inbox Price String>
    [inbox_sms_from_number]: <Inbox SMS From Number String>
    [inbox_sms_to_number]: <Inbox SMS To Number String>
    [inbox_twilio_account_sid]: <Inbox Twilio Account Sid String>
    [inbox_twilio_auth_token]: <Inbox Twilio Auth Token String>
    [is_connect_enabled]: <Connect Service Enabled Bool>
    [is_invoice_enabled]: <Invoice Service Enabled Bool>
    [is_relay_enabled]: <Payment Relay Service Enabled Bool>
    logger: <Winston Logger Object>
    network_nodes: [<Network Node Public Key Hex String]
    [node]: <LND Node String>
    [payer]: <Payer Node String>
    [profile]: <Node Profile String>
    profile_urls: [<Profile URL String>]
  }
*/
module.exports = args => {
  const env = {
    PAID_SERVICES_ACTIVITY_FEES: asFlag(args.activity_fees),
    PAID_SERVICES_ACTIVITY_VOLUME: asFlag(args.activity_volume),
    PAID_SERVICES_CONNECT: asFlag(args.is_connect_enabled),
    PAID_SERVICES_INBOX_EMAIL_FROM: args.inbox_email_from,
    PAID_SERVICES_INBOX_EMAIL_TO: args.inbox_email_to,
    PAID_SERVICES_INBOX_POSTMARK_API_KEY: args.inbox_postmark_api_key,
    PAID_SERVICES_INBOX_PRICE: args.inbox_price,
    PAID_SERVICES_INBOX_SMS_FROM_NUMBER: args.inbox_sms_from_number,
    PAID_SERVICES_INBOX_SMS_TO_NUMBER: args.inbox_sms_to_number,
    PAID_SERVICES_INBOX_TWILIO_ACCOUNT_SID: args.inbox_twilio_account_sid,
    PAID_SERVICES_INBOX_TWILIO_AUTH_TOKEN: args.inbox_twilio_auth_token,
    PAID_SERVICES_INVOICE: asFlag(args.is_invoice_enabled),
    PAID_SERVICES_NETWORK_NODES: args.network_nodes.join(','),
    PAID_SERVICES_PROFILE_FOR_NODE: args.profile,
    PAID_SERVICES_PROFILE_URLS: args.profile_urls.join('\n'),
    PAID_SERVICES_RELAY: asFlag(args.is_relay_enabled),
  };

  return asyncForever(cbk => {
    return asyncAuto({
      // Get lnd
      getLnd: cbk => {
        return authenticatedLnd({logger: args.logger, node: args.node}, cbk);
      },

      // Get payer
      getPayer: cbk => {
        return authenticatedLnd({logger: args.logger, node: args.payer}, cbk);
      },

      // Get identity
      getId: ['getLnd', ({getLnd}, cbk) => {
        return getIdentity({lnd: getLnd.lnd}, cbk);
      }],

      // Get the network name
      getNetwork: ['getLnd', ({getLnd}, cbk) => {
        return getNetwork({lnd: getLnd.lnd}, cbk);
      }],

      // Service requests
      service: [
        'getId',
        'getLnd',
        'getNetwork',
        'getPayer',
        ({getId, getLnd, getNetwork, getPayer}, cbk) =>
      {
        const sub = servicePaidRequests({
          env,
          fetch: args.fetch,
          lnd: getLnd.lnd,
          network: getNetwork.network,
          payer: getPayer.lnd,
        });

        sub.on('error', error => {
          args.logger.error(error);

          // Stop listening to the paid services
          sub.removeAllListeners();

          // Trigger a restart after a delay
          return setTimeout(cbk, restartDelayMs);
        });

        sub.on('failure', failure => args.logger.error(failure));

        sub.on('success', async ({service, node, received}) => {
          const date = new Date().toISOString();
          const got = `received ${mtokAsBig(received)}`;

          if (!node) {
            return args.logger.info(`${date} ${got} ${service}`);
          }

          const {alias} = await getNodeAlias({id: node, lnd: getLnd.lnd});

          const from = `- ${node} ${alias}`.trim();

          return args.logger.info(`${date} ${got} ${service} ${from}`);
        });

        args.logger.info({
          listening_for_requests_via: `bos use ${getId.public_key}`,
        });

        return;
      }],
    },
    cbk);
  },
  err => {
    return args.logger.error({err});
  });
};