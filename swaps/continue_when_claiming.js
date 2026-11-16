/** Get a payment callback that cannot stop a swap that is claiming on chain

  {
    cbk: <Payment Callback Function>
    claiming: {
      [is_claiming]: <Swap Is Claiming On Chain Bool>
    }
    logger: <Winston Logger Object>
  }

  @returns
  {
    finished: <Payment Finished Function> (err, res) => {}
  }
*/
module.exports = ({cbk, claiming, logger}) => {
  return {
    finished: (err, res) => {
      // Exit early when claiming, as the secret can be given out by now
      if (!!err && !!claiming.is_claiming) {
        logger.error({payment_failed_while_claiming: err});

        return cbk();
      }

      return cbk(err, res);
    },
  };
};
