const asyncAuto = require("async/auto");
const { returnResult } = require("asyncjs-util");
const { validateAddress } = require("../chain");
const { subscribeToOpenRequests } = require("ln-service");

module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto(
      {
        // Check arguments
        validate: (cbk) => {
          if (!args.lnd) {
            return cbk([400, "ExpectedAuthenticatedLndToInterceptInboundChannel"]);
          }

          if (!args.logger) {
            return cbk([400, "ExpectedLoggerObjectToInterceptInboundChannel"]);
          }

          if (!args.cooperative_close_address) {
            return cbk([400, "ExpectedCoopCloseAddress"]);
          }

          if (args.network != "mainnet" && args.network != "testnet" && args.network != "regtest") {
            return cbk([400, "ExpectedValidNetworkValue"]);
          }

          return cbk();
        },

        // validate input coop-close-address
        validateAddress: [
          "validate",
          ({}, cbk) => {
            const isValidAddress = validateAddress({ coop_close_address: args.cooperative_close_address, network: args.network });

            if (!isValidAddress) {
              return cbk([400, "FailedAddressValidationCheck"]);
            }

            if (isValidAddress) {
              args.logger.info("Address Validated");
              return cbk(null, args.cooperative_close_address);
            }
          },
        ],

        //intercept open channel requests and adds an address.
        interceptOpenRequests: [
          "validate",
          "validateAddress",
          ({ validateAddress }, cbk) => {
            const sub = subscribeToOpenRequests({ lnd: args.lnd });

            sub.on("error", (err) => {
              return cbk(err);
            });

            sub.on("channel_request", (channel) => {
              channel.accept({ cooperative_close_address: validateAddress });
            });
          },
        ],
      },
      returnResult({ reject, resolve }, cbk)
    );
  });
};
