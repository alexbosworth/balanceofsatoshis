const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/g;
const mtokAsBig = n => (Number(BigInt(n) / BigInt(1e3)) / 1e8).toFixed(8);
const printable = n => !n ? undefined : n.replace(controlCharacters, space);
const space = ' ';

/** Get the details to show for a payment received from a supporter

  The note of a supporter is shown with its control characters as spaces, so
  that it cannot change how the terminal shows other lines

  {
    mtokens: <Received Millitokens String>
    [payer_note]: <Supporter Note String>
    [payer_offer]: <Supporter Signed BOLT 12 Offer String>
  }

  @returns
  {
    received: <Received Amount Big Unit Tokens String>
    [supporter_note]: <Supporter Note String>
    [supporter_offer]: <Supporter Signed BOLT 12 Offer String>
  }
*/
module.exports = args => {
  return {
    received: mtokAsBig(args.mtokens),
    supporter_note: printable(args.payer_note),
    supporter_offer: args.payer_offer,
  };
};
