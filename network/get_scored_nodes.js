const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const api = 'https://nodes.lightning.computer/availability/v1/';
const {isArray} = Array;
const knownNetworks = ['btc', 'btctestnet', 'ltc'];

/** Get scored nodes

  {
    network: <Network Name String>
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    nodes: [{
      public_key: <Public Key Hex String>
      score: <Forwarding Quality Score Out Of One Hundred Million Number>
    }]
  }
*/
module.exports = ({network, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!knownNetworks.find(n => n === network)) {
          return cbk([400, 'ExpectedNetworkToGetScoredNodes']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToGetScoredNodes']);
        }

        return cbk();
      },

      // Get nodes
      getNodes: ['validate', ({}, cbk) => {
        const url = `${api}${network}.json`;

        return request({url, json: true}, (err, r, res) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorGettingNodeScores', {err}]);
          }

          if (!res || !isArray(res.scores)) {
            return cbk([503, 'UnexpectedResultFromNodeScores']);
          }

          if (!!res.scores.find(n => !n.public_key)) {
            return cbk([503, 'ExpectedPublicKeyInNodeScoresResult']);
          }

          if (!!res.scores.find(({score}) => score === undefined)) {
            return cbk([503, 'ExpectedScoreInNodeScoresResult']);
          }

          const nodes = res.scores.map(n => ({
            public_key: n.public_key,
            score: n.score,
          }));

          return cbk(null, {nodes});
        });
      }],
    },
    returnResult({reject, resolve, of: 'getNodes'}, cbk));
  });
};
