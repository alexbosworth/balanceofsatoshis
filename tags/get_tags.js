const {homedir} = require('os');
const {join} = require('path');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {homePath} = require('../storage');

const defaultTags = {tags: []};
const {isArray} = Array;
const {parse} = JSON;
const tagFilePath = () => join(...[homePath({}), 'tags.json']);

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

      // Fetch the tags
      getTags: ['validate', ({}, cbk) => {
        return fs.getFile(tagFilePath(), (err, res) => {
          // Fail back to no tags when there is an error
          if (!!err || !res) {
            return cbk(null, defaultTags);
          }

          try {
            const {tags} = parse(res.toString());

            // Exit early when tags are not well formed
            if (!isArray(tags) || !!tags.filter(n => !n).length) {
              return cbk(null, defaultTags);
            }

            return cbk(null, {tags});
          } catch (err) {
            return cbk(null, defaultTags);
          }
        });
      }],
    },
    returnResult({reject, resolve, of: 'getTags'}, cbk));
  });
};
