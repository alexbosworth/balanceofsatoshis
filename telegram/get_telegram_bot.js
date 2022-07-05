const {homedir} = require('os');
const {join} = require('path');

const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const {Bot} = require('grammy');
const inquirer = require('inquirer');
const {returnResult} = require('asyncjs-util');

const getSocksProxy = require('./get_socks_proxy');
const {home} = require('../storage');
const interaction = require('./interaction');

const botKeyFile = 'telegram_bot_api_key';

/** Get the Telegram Bot object

  {
    fs: {
      getFile: <Get File Contents Function>
      getFileStatus: <Get File Status Function>
      makeDirectory: <Make Directory Function>
      writeFile: <Write File Function>
    }
    [proxy]: <Proxy Details JSON File Path String>
  }

  @returns via cbk or Promise
  {
    bot: <Telegram Bot Object>
    key: <Telegram API Key String>
  }
*/
module.exports = ({fs, proxy}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fs) {
          return cbk([400, 'ExpectedFileSystemMethodsToGetTelegramBot']);
        }

        return cbk();
      },

      // Get proxy agent
      getProxy: ['validate', ({}, cbk) => {
        // Exit early if not using a proxy
        if (!proxy) {
          return cbk();
        }

        return getSocksProxy({fs, path: proxy}, cbk);
      }],

      // Home directory path
      path: ['validate', ({}, cbk) => cbk(null, join(...[homedir(), home()]))],

      // Ask for an API key
      apiKey: ['path', ({path}, cbk) => {
        return fs.getFile(join(...[path, botKeyFile]), (err, res) => {
          // Exit early when resetting the API key
          if (!!err || !res || !res.toString() || !!fs.is_reset_state) {
            const token = interaction.api_token_prompt;

            inquirer.prompt([token]).then(({key}) => cbk(null, {key}));

            return;
          }

          return cbk(null, {is_saved: true, key: res.toString()});
        });
      }],

      // Create the bot
      createBot: ['apiKey', 'getProxy', ({apiKey, getProxy}, cbk) => {
        const {key} = apiKey;

        // Exit early when there is no SOCKS proxy
        if (!getProxy) {
          return cbk(null, {key, bot: new Bot(key)});
        }

        // Initiate bot using proxy agent when configured
        const bot = new Bot(key, {
          client: {baseFetchConfig: {agent: getProxy.agent, compress: true}},
        });

        return cbk(null, {bot, key});
      }],

      // Test the created bot
      test: ['createBot', async ({createBot}) => {
        // Start the bot
        return await createBot.bot.init();
      }],

      // Make the home directory if it's not already present
      makeDir: ['apiKey', 'path', 'test', asyncReflect(({path}, cbk) => {
        return fs.makeDirectory(path, cbk);
      })],

      // Save the bot API key so it doesn't need to be entered next run
      saveKey: ['apiKey', 'path', 'makeDir', ({apiKey, path}, cbk) => {
        // Exit early when API key is already saved
        if (!!apiKey.is_saved) {
          return cbk();
        }

        // Ignore errors when making directory, it may already be present
        return fs.writeFile(join(...[path, botKeyFile]), apiKey.key, err => {
          if (!!err) {
            return cbk([503, 'FailedToSaveTelegramApiToken', {err}]);
          }

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve, of: 'createBot'}, cbk));
  });
};
