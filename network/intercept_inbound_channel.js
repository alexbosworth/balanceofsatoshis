const asyncAuto = require("async/auto");
const { returnResult } = require("asyncjs-util");
const generateAddressFromPubkey = require("../chain/generate_address_from_pubkey.js");
const { subscribeToOpenRequests } = require("ln-service");
const { join } = require("path");
const fs = require("fs");
const { parse } = JSON;
const { homedir } = require("os");
const home = ".bos";
const pubkeyFileName = "master_pubkey.json";

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
          return cbk();
        },

        //read the master pubkey and network from file
        getFile: [
          "validate",
          ({}, cbk) => {
            const path = join(...[homedir(), home, pubkeyFileName]);

            return fs.readFile(path, (err, res) => {
              if (err) {
                return cbk([400, "MissingMasterPubkeyJSONFile"]);
              }
              try {
                parse(res.toString());
              } catch (err) {
                return cbk([400, "MasterPubkeyFileHasInvalidData"]);
              }

              const masterPubkeyData = parse(res.toString());

              return cbk(null, masterPubkeyData);
            });
          },
        ],

        //generate address first time to check it works
        getAddress: [
          "validate",
          "getFile",
          ({ getFile }, cbk) => {
            const address = generateAddressFromPubkey({ network: getFile.network, masterPubKey: getFile.master_pubkey });

            if (!address) {
              return cbk([400, "FailedToGenerateAddressFromPubkey"]);
            }
            // logger.info("Address Successfully Generated");

            return cbk(null, address);
          },
        ],

        //intercept open channel requests and generate addresses on the fly.
        interceptOpenRequests: [
          "validate",
          "getFile",
          "getAddress",
          ({ getAddress, getFile }, cbk) => {
            const sub = subscribeToOpenRequests({ lnd: args.lnd });

            if (!getAddress.address) {
              return cbk([400, "FailedToGenerateAddressFromPubkey"]);
            }
            sub.on("channel_request", (channel) => {
              const address = generateAddressFromPubkey({ network: getFile.network, masterPubKey: getFile.master_pubkey }).address;

              channel.accept({ cooperative_close_address: address });
            });
          },
        ],
      },
      returnResult({ reject, resolve }, cbk)
    );
  });
};
