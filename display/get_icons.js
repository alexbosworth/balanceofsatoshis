const {homedir} = require('os');
const {join} = require('path');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const flatten = arr => [].concat(...arr);
const {isArray} = Array;
const {parse} = JSON;
const tagFilePath = () => join(...[homedir(), '.bos', 'tags.json']);
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

      // Get icons from the tags file
      getIcons: ['validate', ({}, cbk) => {
        return fs.getFile(tagFilePath(), (err, res) => {
          // Exit early when there is no tag file
          if (!!err || !res) {
            return cbk(null, {nodes: []});
          }

          try {
            const file = parse(res.toString());

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

            return cbk(null, {nodes});
          } catch (err) {
            return cbk(null, {nodes: []});
          }
        });
      }],
    },
    returnResult({reject, resolve, of: 'getIcons'}, cbk));
  });
};
