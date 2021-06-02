const {servicePaidRequests} = require('paid-services');

/** Service KeySend payment requests

  {
    fetch: <Fetch Function>
    [inbox_email_from]: <Inbox Email From Address String>
    [inbox_email_to]: <Inbox Email To Address String>
    [inbox_postmark_api_key]: <Inbox Postmark API Key String>
    [inbox_price]: <Inbox Price String>
    [inbox_sms_from_number]: <Inbox SMS From Number String>
    [inbox_sms_to_number]: <Inbox SMS To Number String>
    [inbox_twilio_account_sid]: <Inbox Twilio Account Sid String>
    [inbox_twilio_auth_token]: <Inbox Twilio Auth Token String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    network: <Network Name String>
    network_nodes: [<Network Node Public Key Hex String]
    payer: <Payer Authenticated LND API Object>
    [profile]: <Node Profile String>
    profile_urls: [<Profile URL String>]
  }
*/
module.exports = args => {
  const sub = servicePaidRequests({
    fetch: args.fetch,
    lnd: args.lnd,
    env: {
      PAID_SERVICES_INBOX_EMAIL_FROM: args.inbox_email_from,
      PAID_SERVICES_INBOX_EMAIL_TO: args.inbox_email_to,
      PAID_SERVICES_INBOX_POSTMARK_API_KEY: args.inbox_postmark_api_key,
      PAID_SERVICES_INBOX_PRICE: args.inbox_price,
      PAID_SERVICES_INBOX_SMS_FROM_NUMBER: args.inbox_sms_from_number,
      PAID_SERVICES_INBOX_SMS_TO_NUMBER: args.inbox_sms_to_number,
      PAID_SERVICES_INBOX_TWILIO_ACCOUNT_SID: args.inbox_twilio_account_sid,
      PAID_SERVICES_INBOX_TWILIO_AUTH_TOKEN: args.inbox_twilio_auth_token,
      PAID_SERVICES_NETWORK_NODES: args.network_nodes.join(','),
      PAID_SERVICES_PROFILE_FOR_NODE: args.profile,
      PAID_SERVICES_PROFILE_URLS: args.profile_urls.join('\n'),
    },
    network: args.network,
    payer: args.payer,
  });

  sub.on('error', error => args.logger.error(error));
  sub.on('failure', failure => args.logger.error(failure));
  sub.on('success', success => args.logger.info(success));

  return;
};