const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {authenticatedLndGrpc} = require('ln-service');
const {getNetworkGraph} = require('ln-service');
const request = require('request');
const {returnResult} = require('asyncjs-util');
const {setAutopilot} = require('ln-service');

const {lndCredentials} = require('./../lnd');

const average = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
const flatten = arr => [].concat(...arr);
const {floor} = Math;
const {isArray} = Array;
const {keys} = Object;
const {max} = Math;
const maxChannelSize = 16777215;
const maxScore = 1e8;
const minChannelSize = 20000;
const minScore = 0;
const pubKeyLen = 66;

/** Setup or turn off autopilot

  {
    [is_dryrun]: <Only Display Scores But Take No Action Bool>
    is_enabled: <Autopilot Enabled Status Bool>
    [mirrors]: [<Mirror Channel of Node With Public Key Hex String>]
    [node]: <Saved Node Name String>
    [urls]: [<Follow Scores of ]
  }

  @returns via cbk
  {
    [candidate_nodes]: <Autopilot Candidate Nodes Count Number>
    is_enabled: <Autopilot is Enabled Bool>
  }
*/
module.exports = (args, cbk) => {
  return asyncAuto({
    // Credentials
    credentials: cbk => lndCredentials({node: args.node}, cbk),

    // Check arguments
    validate: cbk => {
      if (args.is_enabled !== true && args.is_enabled !== false) {
        return cbk([400, 'ExpectedEnabledStatusForAutopilot']);
      }

      if (!args.is_enabled && !!args.mirrors.length && !!args.urls.length) {
        return cbk([400, 'UnexpectedAutopilotOperationSettingsWhenDisabling']);
      }

      if (!!args.mirrors && !isArray(args.mirrors)) {
        return cbk([400, 'ExpectedArrayOfMirrorsForAutopilot']);
      }

      if (!!args.urls && !isArray(args.urls)) {
        return cbk([400, 'ExpectedArrayofUrlsForAutopilot']);
      }

      const hasInvalidMirror = (args.mirrors || []).find(pubKey => {
        return !pubKey || pubKey.length !== pubKeyLen;
      });

      if (!!hasInvalidMirror) {
        return cbk([400, 'ExpectedValidNodePublicKeyToMirror']);
      }

      const hasInvalidUrl = (args.urls || []).find(url => {
        try {
          return !(new URL(url));
        } catch (err) {
          return true;
        }
      });

      if (!!hasInvalidUrl) {
        return cbk([400, 'ExpectedValidUrlForRemoteAutopilotScores']);
      }

      return cbk();
    },

    // Get scores from URLs
    getUrlNodes: ['validate', ({}, cbk) => {
      return asyncMap(args.urls, (url, cbk) => {
        return request({url, json: true}, (err, r, body) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorGettingScoreUrl', {err, url}]);
          }

          if (!r || r.statusCode !== 200) {
            return cbk([503, 'UnexpectedStatusFromScoreUrlRequest', {url}]);
          }

          if (!body || !isArray(body.scores)) {
            return cbk([503, 'ExpectedNodeScoreDataFromRemoteUrl', {url}]);
          }

          return asyncMap(body.scores, (node, cbk) => {
            if (!node) {
              return cbk([503, 'ExpectedNodeDetailsFromRemoteUrl']);
            }

            if (!node.public_key || node.public_key.length !== pubKeyLen) {
              return cbk([503, 'ExpectedNodePublicKeyInRemoteUrlResponse']);
            }

            if (node.score === undefined) {
              return cbk([503, 'ExpectedNodeSocreInRemoteUrlResposne']);
            }

            if (node.score < minScore || node.score > maxScore) {
              return cbk([503, 'UnexpectedNodeScoreInRemoteUrlResponse']);
            }

            return cbk(null, {public_key: node.public_key, score: node.score});
          },
          cbk);
        });
      },
      cbk);
    }],

    // Lnd
    lnd: ['credentials', ({credentials}, cbk) => {
      return cbk(null, authenticatedLndGrpc({
        cert: credentials.cert,
        macaroon: credentials.macaroon,
        socket: credentials.socket,
      }).lnd);
    }],

    // Get the mirror nodes
    getMirrorNodes: ['lnd', ({lnd}, cbk) => {
      if (!args.mirrors || !args.mirrors.length) {
        return cbk(null, []);
      }

      return getNetworkGraph({lnd}, (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        return asyncMap(args.mirrors, (pubKey, cbk) => {
          const channels = res.channels.filter(({capacity, policies}) => {
            if (capacity > maxChannelSize || capacity < minChannelSize) {
              return false;
            }

            if (!policies.find(n => n.is_disabled)) {
              return false;
            }

            if (!policies.find(n => n.public_key === pubKey)) {
              return false;
            }

            return true;
          });

          const committed = {};

          channels.forEach(({capacity, policies}) => {
            const key = policies.find(n => n.public_key !== pubKey).public_key;

            return committed[key] = (committed[key] || 0) + capacity;
          });

          const maxCommitted = max(...keys(committed).map(k => committed[k]));

          return cbk(null, keys(committed).map(publicKey => {
            const node = res.nodes.find(n => n.public_key === publicKey);

            return {
              alias: (node || {}).alias,
              public_key: publicKey,
              score: floor(committed[publicKey] / maxCommitted * maxScore),
            };
          }));
        },
        cbk);
      });
    }],

    // Calculate the candidate scores
    candidateNodes: [
      'getMirrorNodes',
      'getUrlNodes',
      ({getMirrorNodes, getUrlNodes}, cbk) =>
    {
      const nodes = []
        .concat(flatten(getMirrorNodes))
        .concat(flatten(getUrlNodes));

      const candidates = {};

      nodes.forEach(node => {
        const score = candidates[node.public_key] || node.score;

        return candidates[node.public_key] = average([score, node.score]);
      });

      return cbk(null, keys(candidates).map(publicKey => ({
        alias: nodes.find(n => n.public_key === publicKey).alias,
        public_key: publicKey,
        score: floor(candidates[publicKey]),
      })));
    }],

    // Action
    action: ['candidateNodes', ({candidateNodes}, cbk) => {
      return cbk(null, {
        candidate_nodes: candidateNodes.length || undefined,
        is_enabled: args.is_enabled,
      });
    }],

    // Set autopilot
    setAutopilot: ['lnd', 'candidateNodes', ({lnd, candidateNodes}, cbk) => {
      if (!!args.is_dryrun) {
        return cbk();
      }

      return setAutopilot({
        lnd,
        candidateNodes: !candidateNodes.length ? undefined : candidateNodes,
        is_enabled: args.is_enabled,
      },
      cbk);
    }],
  },
  returnResult({of: 'action'}, cbk));
};
