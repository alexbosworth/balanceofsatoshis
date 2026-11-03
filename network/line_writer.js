/** Make a writer that writes log lines in the order they were started

  {
    logger: <Winston Logger Object>
  }

  @returns
  {
    wait: <Wait For Lines To Be Written Function> () => <Promise>
    write: <Write Line Function> (<Line Promise Object>) => {}
  }
*/
module.exports = ({logger}) => {
  let written = Promise.resolve();

  return {
    wait: () => written,
    write: line => {
      // Catch an error making the line now so that it is not unhandled
      const made = line.catch(err => ({err}));

      written = written.then(() => made).then(({err, ...entry}) => {
        return !!err ? logger.error({err}) : logger.info(entry);
      });

      return;
    },
  };
};
