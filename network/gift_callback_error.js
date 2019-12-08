/** Map a gift route error to a callback error

  {
    err: {
      message: <Error Message String>
    }
  }

  @returns
  [
    <Callback Error Code Number>
    <Callback Error Message String>
    [Callback Error Context Object>]
  ]
*/
module.exports = ({err}) => {
  const {message} = err;

  switch (message) {
  case 'NoActiveChannelWithSpecifiedPeer':
    return [400, 'SendingGiftRequiresActiveChannelWithPeer'];

  case 'NoActiveChannelWithSufficientLocalBalance':
    return [400, 'SendingGiftRequiresChanWithSufficientBalance'];

  case 'NoActiveChannelWithSufficientRemoteBalance':
    return [400, 'SendingGiftRequiresChanWithSomeRemoteBalance'];

  case 'NoDirectChannelWithSpecifiedPeer':
    return [400, 'SendingGiftRequiresDirectChannelWithPeer'];

  default:
    return [500, 'UnexpectedErrorDeterminingChanForGift', {err}];
  }
};
