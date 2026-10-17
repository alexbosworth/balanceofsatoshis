/** Determine if a transaction input spends one of a set of contract outputs

  Contract outputs without an output index refer to all outputs of the tx

  {
    id: <Input Spends Transaction Id Hex String>
    outputs: [{
      id: <Contract Transaction Id Hex String>
      [vout]: <Contract Transaction Output Index Number>
    }]
    vout: <Input Spends Transaction Output Index Number>
  }

  @returns
  <Input Spends A Contract Output Bool>
*/
module.exports = args => {
  return !!args.outputs.find(output => {
    // Exit early when the input does not spend the contract transaction
    if (output.id !== args.id) {
      return false;
    }

    return output.vout === undefined || output.vout === args.vout;
  });
};
