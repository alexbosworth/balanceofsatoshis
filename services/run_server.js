const asyncAuto = require('async/auto');
const {createSupportOffer} = require('paid-services');
const qrcode = require('qrcode-terminal');
const {returnResult} = require('asyncjs-util');
const {serviceSupportOffer} = require('paid-services');

const getOfferIntroduction = require('./get_offer_introduction');
const supporterDetails = require('./supporter_details');

const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})+$/i.test(n);
const urlForOffer = offer => `lightning:${offer}`;

/** Run a server of paid services: a support offer that supporters can pay

  A new support offer service is made, unless the service record of a service
  that was made before is given to resume running it. The offer is shown once
  the service has checked its record, with the record of a new service, and
  with a QR code of the offer when asked for. The offer can only be paid while
  the server is running.

  The offer path of a node that only has private channels starts at a public
  peer, so that payers can reach it.

  The server runs until the service ends, and then returns an error.

  {
    [is_including_qr]: <Show QR Code of Offer Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [record]: <Resume Service With Service Record Hex String>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRunServer']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToRunServer']);
        }

        if (!!args.record && !isHex(args.record)) {
          return cbk([400, 'ExpectedHexServiceRecordToResumeService']);
        }

        return cbk();
      },

      // Find the peer to start a new offer path at, for a private node
      getIntroduction: ['validate', ({}, cbk) => {
        // Exit early when resuming a service, its offer already has a path
        if (!!args.record) {
          return cbk(null, {});
        }

        return getOfferIntroduction({lnd: args.lnd}, cbk);
      }],

      // Make a new support offer when not resuming a service
      createOffer: ['getIntroduction', ({getIntroduction}, cbk) => {
        // Exit early when resuming a service from its service record
        if (!!args.record) {
          return cbk();
        }

        return createSupportOffer({
          introduction: getIntroduction.introduction,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Run the support offer service until it ends
      run: ['createOffer', ({createOffer}, cbk) => {
        const record = !createOffer ? args.record : createOffer.record;

        let service;

        try {
          service = serviceSupportOffer({record, lnd: args.lnd});
        } catch (err) {
          return cbk([400, 'FailedToRunSupportOfferService', {err}]);
        }

        service.error(err => args.logger.error({err}));

        // Show the offer once the service has checked its record, with the
        // record of a new service, which is used to resume the service later
        service.start(({offer}) => {
          const show = code => args.logger.info({
            public_offer: offer,
            qr: code,
            service_record: !!createOffer ? createOffer.record : undefined,
          });

          // Exit early when not showing a QR code of the offer
          if (!args.is_including_qr) {
            return show();
          }

          return qrcode.generate(urlForOffer(offer), {small: true}, show);
        });

        // Show the payments of supporters as they are received
        service.supporter(supporter => {
          return args.logger.info(supporterDetails(supporter));
        });

        // The server stops running when the service ends
        return service.end(() => cbk([503, 'SupportOfferServiceEnded']));
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
