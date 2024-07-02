const minimist = require('minimist');
const tabtab = require('tabtab');

const arguments = () => process.argv.slice(2);

/** Initialize autocomplete

  {
    prog: <Caporal Program Object>
  }
*/
module.exports = ({prog}) => {
  const opts = minimist(arguments());

  const args = opts._;

  const completion = env => {
    // Exit early when not completing a tab
    if (!env.complete) {
      return;
    }

    // Find the referenced command to see if it exists and has options
    const command = prog.getCommands().find(n => n.name() === env.prev);

    // Exit early when looking at the options for a command
    if (!!command) {
      return tabtab.log(command._options.map(option => ({
        description: option._description,
        name: option.getLongName(),
      })));
    }

    // Filter out invisible commands
    const visible = prog.getCommands().filter(n => n._visible);

    // List all the relevant commands
    return tabtab.log(visible.map(command => ({
      description: command._description,
      name: command.name(),
    })));
  };

  // Look for completion help
  const init = async () => {
    const [cmd] = args;

    // Exit early when not helping with completion
    if (cmd !== 'completion') {
      return;
    }

    const env = tabtab.parseEnv(process.env);

    return completion(env);
  };

  return init();
};