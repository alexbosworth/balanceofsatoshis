const asyncAuto = require('async/auto');
const asyncEachSeries = require('async/eachSeries');
const asyncWhilst = require('async/whilst');
const {deletePayment} = require('ln-service');
const {getFailedPayments} = require('ln-service');
const {getWalletVersion} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const defaultPagingLimit = 1000;
const {isArray} = Array;
const unsupported = 501;

/** Clean out failed payments from the wallet

  {
    is_dry_run: <Avoid Actually Deleting Payments>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndApiToCleanPayments']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToCleanFailedPayments']);
        }

        return cbk();
      },

      // Try and determine what wallet version this is
      getWalletVersion: ['validate', ({}, cbk) => {
        return getWalletVersion({lnd: args.lnd}, cbk);
      }],

      // Deny known unsupported versions
      checkWalletVersion: ['getWalletVersion', ({getWalletVersion}, cbk) => {
        // Exit early when not actually deleting
        if (!!args.is_dry_run) {
          return cbk();
        }

        switch (getWalletVersion.version) {
        case '0.11.0-beta':
        case '0.11.1-beta':
        case '0.12.0-beta':
        case '0.12.1-beta':
        case '0.13.0-beta':
        case '0.13.1-beta':
        case '0.13.2-beta':
        case '0.13.3-beta':
          return cbk([501, 'CleanFailedPaymentsUnsupportedOnThisLndVersion']);

        default:
          return cbk();
        }
      }],

      // Delete failed payments
      fetchAndDelete: ['checkWalletVersion', ({}, cbk) => {
        const ids = [];
        let token;

        if (!!args.is_dry_run) {
          args.logger.info({finding_failed_payments: true});
        } else {
          args.logger.info({deleting_failed_payments: true});
        }

        return asyncWhilst(
          cbk => cbk(null, token !== false),
          cbk => {
            return getFailedPayments({
              token,
              limit: !token ? defaultPagingLimit : undefined,
              lnd: args.lnd,
            },
            (err, res) => {
              if (!!err) {
                return cbk([503, 'UnexpectedErrorGettingPayFailures', {err}]);
              }

              // Setting token to false will signal the end of paging
              token = res.next || false;

              // Exit early when there
              if (!res.payments.length) {
                const date = new Date().toISOString();

                args.logger.info({searching_for_failed_payments: date});

                return cbk();
              }

              res.payments.forEach(({id}) => ids.push(id));

              // Delete each payment
              return asyncEachSeries(res.payments, ({id}, cbk) => {
                // Exit early when doing a dry run
                if (!!args.is_dry_run) {
                  return cbk();
                }

                return deletePayment({id, lnd: args.lnd}, err => {
                  // LND 0.13.3 and below do not support deleting payments
                  if (!!isArray(err) && err.slice().shift() === unsupported) {
                    return cbk([501, 'LndVersionDoesNotSupportFailDeletion']);
                  }

                  if (!!err) {
                    return cbk([503, 'UnexpectedErrorDeletingPayment', {err}]);
                  }

                  return cbk();
                });
              },
              err => {
                if (!!err) {
                  return cbk(err);
                }

                args.logger.info({failed_payments: ids.length});

                return cbk();
              });
            });
          },
          err => {
            if (!!err) {
              return cbk(err);
            }

            // Exit early when this is a test
            if (!!args.is_dry_run) {
              return cbk(null, {total_failed_payments_found: ids.length});
            }

            return cbk(null, {total_failed_payments_deleted: ids.length});
          }
        );
      }],
    },
    returnResult({reject, resolve, of: 'fetchAndDelete'}, cbk));
  });
};
