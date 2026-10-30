const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const {returnResult} = require('asyncjs-util');

const {homePath} = require('../storage');

const defaultTags = {tags: []};
const {isArray} = Array;
const {parse} = JSON;
const tagFilePath = () => homePath({file: 'tags.json'}).path;

/** Get tagged nodes

  {
    fs: {
      getFile: <Get File Function>
    }
  }

  @returns via cbk or Promise
  {
    tags: [{
      alias: <Tag Alias String>
      id: <Tag Id String>
      [is_avoided]: <Avoid Node in Routing Bool>
      nodes: [<Node Public Key Hex String>]
    }]
  }
*/
module.exports = ({fs}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFileSystemMethodsToGetTags']);
        }

        return cbk();
      },

      // Fetch the tags file
      getFile: ['validate', ({}, cbk) => {
        return fs.getFile(tagFilePath(), (err, res) => {
          // Exit early when there is no tags file
          if (!!err || !res) {
            return cbk();
          }

          return cbk(null, res.toString());
        });
      }],

      // Parse the tags out of the tags file
      getTags: ['getFile', asyncify(({getFile}) => {
        // Fail back to no tags when there is no tags file
        if (!getFile) {
          return defaultTags;
        }

        try {
          const {tags} = parse(getFile);

          // Exit early when tags are not well formed
          if (!isArray(tags) || !!tags.filter(n => !n).length) {
            return defaultTags;
          }

          return {tags};
        } catch (err) {
          return defaultTags;
        }
      })],
    },
    returnResult({reject, resolve, of: 'getTags'}, cbk));
  });
};
