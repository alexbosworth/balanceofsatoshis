const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const {returnResult} = require('asyncjs-util');

const {homePath} = require('../storage');

const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const {parse} = JSON;
const tagFilePath = () => homePath({file: 'tags.json'}).path;
const uniq = arr => Array.from(new Set(arr));

/** Get icons for public keys from tags

  {
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
    }
  }

  @returns via cbk or Promise
  {
    nodes: [{
      aliases: [<Alias String>]
      icons: [<Icon String>]
      public_key: <Public Key Hex String>
    }]
  }
*/
module.exports = ({fs}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFileSystemMethodsToGetIconsForNodes']);
        }

        return cbk();
      },

      // Get the tags file
      getFile: ['validate', ({}, cbk) => {
        return fs.getFile(tagFilePath(), (err, res) => {
          // Exit early when there is no tag file
          if (!!err || !res) {
            return cbk();
          }

          return cbk(null, res.toString());
        });
      }],

      // Get icons from the tags file
      getIcons: ['getFile', asyncify(({getFile}) => {
        // Exit early when there is no tag file
        if (!getFile) {
          return {nodes: []};
        }

        try {
          const file = parse(getFile);

          const keys = uniq(flatten(file.tags.map(n => n.nodes)));

          const nodes = keys.map(key => {
            // Only tags this node is included in
            const meta = file.tags.filter(tag => {
              return isArray(tag.nodes) && tag.nodes.includes(key);
            });

            return {
              aliases: uniq(meta.map(n => n.alias)),
              icons: uniq(meta.map(n => n.icon)),
              public_key: key,
            };
          });

          return {nodes};
        } catch (err) {
          return {nodes: []};
        }
      })],
    },
    returnResult({reject, resolve, of: 'getIcons'}, cbk));
  });
};
