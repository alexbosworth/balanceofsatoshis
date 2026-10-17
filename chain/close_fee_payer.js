const {componentsOfTransaction} = require('@alexbosworth/blockchain');

const simpleCloseSequence = 0xfffffffd;

/** Determine which side paid the fee of a channel close transaction

  {
    [is_cooperative_close]: <Channel Was Cooperatively Closed Bool>
    [is_partner_closed]: <Channel Was Closed By Peer Bool>
    [is_partner_initiated]: <Channel Was Opened By Peer Bool>
    [transaction]: <Raw Close Transaction Hex String>
  }

  @returns
  {
    [is_peer_paying]: <Peer Paid The Close Transaction Fee Bool>
  }
*/
module.exports = args => {
  const isPeerClosed = args.is_partner_closed;
  const isPeerOpened = args.is_partner_initiated;

  // Exit early when the channel was force closed, the opener paid for that
  if (!args.is_cooperative_close) {
    return {is_peer_paying: isPeerOpened};
  }

  const isOpenerClosing = isPeerOpened === isPeerClosed;

  // Exit early when the opener also closed, they paid in either protocol
  if (isPeerOpened !== undefined && isOpenerClosing) {
    return {is_peer_paying: isPeerOpened};
  }

  // Exit early when the close protocol is unknown without the close tx
  if (!args.transaction) {
    return {};
  }

  const {inputs} = componentsOfTransaction({transaction: args.transaction});

  const [fundingSpend] = inputs;

  // The closer pays for a simple close, otherwise the opener pays
  const isSimpleClose = fundingSpend.sequence === simpleCloseSequence;

  return {is_peer_paying: isSimpleClose ? isPeerClosed : isPeerOpened};
};
