const {homedir} = require('os');
const {join} = require('path');
const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const defaultTagsFile = {tags: []};
const home = '.bos';
const {isArray} = Array;
const isHash = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const isString = n => typeof n === 'string';
const makeId = () => randomBytes(32).toString('hex');
const makeTag = (alias, id) => ({alias, id});
const {parse} = JSON;
const stringify = obj => JSON.stringify(obj, null, 2);
const tagFilePath = () => join(...[homedir(), '.bos', 'tags.json']);
const uniq = arr => Array.from(new Set(arr));

/** Adjust tags

  {
    add: [<Node To Add To Tag Public Key Hex String>]
    fs: {
      getFile: <Read File Contents Function> (path, cbk) => {}
      makeDirectory: <Make Directory Function> (path, cbk) => {}
      writeFile: <Write File Contents Function> (path, contents, cbk) => {}
    }
    [id]: <Id to Use for New Tag Hex String>
    [icon]: <Tag Icon String>
    [is_avoided]: <Set Avoid Flag on Tag Bool>
    remove: [<Node to Remove From Tag Public Key Hex String>]
    [tag]: <Tag Alias or Id to Adjust String>
  }

  @returns via cbk or Promise
  {
    [tags]: [{
      icon: <Tag Icon String>
      id: <Tag Id Hex String>
      name: <Tag Name String>
      nodes: [{
        alias: <Node Alias String>
        public_key: <Public Key Hex String>
      }]
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.add)) {
          return cbk([400, 'ExpectedArrayOfNodesToAddToTag']);
        }

        if (!!args.add.filter(n => !isPublicKey(n)).length) {
          return cbk([400, 'ExpectedPublicKeyOfNodeToAddToTag']);
        }

        if (!args.fs) {
          return cbk([400, 'ExpectedFileSystemMethodsToAdjustTags']);
        }

        if (!!args.id && !isHash(args.id)) {
          return cbk([400, 'ExpectedHashFormatForTagId']);
        }

        if (!isArray(args.remove)) {
          return cbk([400, 'ExpectedArrayOfNodesToRemoveFromTag']);
        }

        if (!!args.remove.filter(n => !isPublicKey(n)).length) {
          return cbk([400, 'ExpectedPublicKeyOfNodeToRemoveFromTag']);
        }

        return cbk();
      },

      // Register the home directory
      registerHomeDir: ['validate', ({}, cbk) => {
        return args.fs.makeDirectory(join(...[homedir(), home]), err => {
          // Ignore errors, the directory may already be there
          return cbk();
        });
      }],

      // Get the current tags from the tag file
      getTags: ['registerHomeDir', ({}, cbk) => {
        return args.fs.getFile(tagFilePath(), (err, res) => {
          // Potentially there's no tag file yet
          if (!!err || !res) {
            return cbk(null, Buffer.from(stringify(defaultTagsFile)));
          }

          try {
            parse(res.toString());
          } catch (err) {
            return cbk([400, 'ExpectedValidJsonTagsFileToAdjustTags', {err}]);
          }

          const file = parse(res.toString());

          if (!isArray(file.tags)) {
            return cbk([400, 'ExpectedTagsArrayInTagsFileToAdjustTags']);
          }

          if (file.tags.find(n => !isHash(n.id))) {
            return cbk([400, 'ExpectedIdForTagToAdjustTags']);
          }

          if (file.tags.find(n => !!n.alias && !isString(n.alias))) {
            return cbk([400, 'ExpectedAliasStringToAdjustTags']);
          }

          return cbk(null, res.toString());
        });
      }],

      // Adjust a tag
      adjustTag: ['getTags', ({getTags}, cbk) => {
        // Exit early when no tag is specified
        if (!args.tag) {
          return cbk();
        }

        const file = parse(getTags);

        // Look for a direct match on a tag
        const tagById = file.tags.find(({id}) => args.tag === id);

        // Look for matches on a tag that aren't direct matches
        const [tagMatch, ...tagMatches] = file.tags.filter(({alias, id}) => {
          // Exit early when there is a direct match already
          if (!!tagById) {
            return id === tagById.id;
          }

          const isMatch = (alias || String()).toLowerCase().includes(args.tag);

          return isMatch || id.startsWith(args.tag);
        });

        // Exit early with error when removing from a non-existent tag
        if (!tagMatch && !!args.remove.length) {
          return cbk([400, 'FailedToFindTheTagToRemoveFrom']);
        }

        // Exit early with error when there is more than one match
        if (!!tagMatches.length) {
          const matches = [].concat(tagMatch).concat(tagMatches);

          return cbk([400, 'AmbiguousTagToAdjustSpecified', {matches}]);
        }

        const setAvoid = args.is_avoided !== undefined;
        const setIcon = args.icon !== undefined;

        // Exit early when not editing the tag
        if (!args.add.length && !setAvoid && !setIcon && !args.remove.length) {
          return cbk(null, tagMatch);
        }

        const tagToAdjust = tagMatch || makeTag(args.tag, args.id || makeId());

        // Add a new tag when there is no match on an existing tag
        if (!tagMatch) {
          file.tags.push(tagToAdjust);
        }

        const nodes = uniq((tagToAdjust.nodes || []).concat(args.add));

        // Set the icon on the tag or unset it when empty
        if (args.icon !== undefined) {
          tagToAdjust.icon = args.icon || undefined;
        }

        // Set the avoid flag on a tag
        if (args.is_avoided) {
          tagToAdjust.is_avoided = args.is_avoided || undefined;
        }

        // Set the adjusted nodes list with removed nodes eliminated
        tagToAdjust.nodes = nodes.filter(n => !args.remove.includes(n));

        return args.fs.writeFile(tagFilePath(), stringify(file), err => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorSavingTagFileUpdate', {err}]);
          }

          return cbk(null, tagToAdjust);
        });
      }],

      // Final result shows either a single tag being adjusted, or all tags
      result: ['adjustTag', ({adjustTag, getTags}, cbk) => {
        if (!!adjustTag) {
          return cbk(null, {tag: adjustTag});
        }

        return cbk(null, {
          tags: parse(getTags).tags.filter(n => !!n.nodes && !!n.nodes.length),
        });
      }],
    },
    returnResult({reject, resolve, of: 'result'}, cbk));
  });
};
