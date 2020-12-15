const {homedir} = require('os');
const {join} = require('path');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const flatten = arr => [].concat(...arr);
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
              const icons = file.tags.filter(tag => {
                return tag.nodes && tag.nodes.includes(key);
              });

              return {
                icons: uniq(icons.map(n => n.icon)),
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
