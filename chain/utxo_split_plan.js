const {sortBy} = require('./../arrays');

const fundedOutputs = require('./funded_outputs');

const {ceil} = Math;
const inputVbytes = {np2wpkh: 92, p2tr: 58, p2wpkh: 69};
const {isArray} = Array;
const splitOutputVbytes = 31;
const unknownInputVbytes = 92;

/** Plan the inputs and outputs of a transaction that splits utxos

  Spending a utxo that is already counted removes it from the count, so it has
  to be replaced. Change counts as a new utxo when it is at least the size.

  Confirmed utxos are spent, starting with the utxos that have the most value
  beyond what they already count for, until the outputs reaching the count can
  be funded.

  {
    count: <Count of UTXOs Number>
    fee_tokens_per_vbyte: <Fee Tokens Per Virtual Byte Number>
    [is_confirmed]: <Only Count Confirmed UTXOs Bool>
    size: <UTXO Minimum Tokens Number>
    utxos: [{
      address_format: <Address Format String>
      confirmation_count: <Confirmation Count Number>
      tokens: <Unspent Tokens Number>
      transaction_id: <Transaction Id Hex String>
      transaction_vout: <Transaction Output Index Number>
    }]
  }

  @throws
  <Error>

  @returns
  {
    inputs: [{
      transaction_id: <Spend Transaction Id Hex String>
      transaction_vout: <Spend Transaction Output Index Number>
    }]
    outputs: <Split Outputs Count Number>
  }
*/
module.exports = args => {
  if (!args.count) {
    throw new Error('ExpectedCountOfUtxosToPlanUtxoSplit');
  }

  if (!args.fee_tokens_per_vbyte) {
    throw new Error('ExpectedFeeRateToPlanUtxoSplit');
  }

  if (!args.size) {
    throw new Error('ExpectedSizeOfUtxosToPlanUtxoSplit');
  }

  if (!isArray(args.utxos)) {
    throw new Error('ExpectedArrayOfUtxosToPlanUtxoSplit');
  }

  const fee = vbytes => ceil(vbytes * args.fee_tokens_per_vbyte);
  const isConfirmedEnough = n => !args.is_confirmed || !!n.confirmation_count;

  const isCounted = n => isConfirmedEnough(n) && n.tokens >= args.size;

  const counted = args.utxos.filter(isCounted);

  // Exit early when there are already enough utxos
  if (counted.length >= args.count) {
    return {inputs: [], outputs: [].length};
  }

  // A counted utxo that is spent has to be replaced with a split output
  const replacement = args.size + fee(splitOutputVbytes);

  const candidates = args.utxos.filter(n => !!n.confirmation_count).map(n => {
    const isReplaced = isCounted(n);
    const vbytes = inputVbytes[n.address_format] || unknownInputVbytes;

    const value = n.tokens - fee(vbytes);

    return {
      vbytes,
      is_counted: isReplaced,
      surplus: isReplaced ? value - replacement : value,
      tokens: n.tokens,
      transaction_id: n.transaction_id,
      transaction_vout: n.transaction_vout,
    };
  });

  // Only utxos that add value can help, so spend the most valuable ones first
  const spending = sortBy({
    array: candidates.filter(n => n.surplus > Number()),
    attribute: 'surplus',
  });

  const spend = spending.sorted.reverse();

  // Select the fewest inputs that fund enough outputs to reach the count
  const selection = spend.reduce((sum, utxo, i) => {
    // Exit early when enough inputs are already selected
    if (sum.outputs !== undefined) {
      return sum;
    }

    const selected = {
      counted: sum.counted + Number(utxo.is_counted),
      inputs: i + 1,
      tokens: sum.tokens + utxo.tokens,
      vbytes: sum.vbytes + utxo.vbytes,
    };

    const {outputs} = fundedOutputs({
      counted: selected.counted,
      inputs: selected.inputs,
      needed: args.count - counted.length,
      rate: args.fee_tokens_per_vbyte,
      size: args.size,
      tokens: selected.tokens,
      vbytes: selected.vbytes,
    });

    return {...selected, outputs};
  },
  {counted: 0, inputs: 0, tokens: 0, vbytes: 0});

  // Exit early with an error when the funds cannot reach the count of utxos
  if (selection.outputs === undefined) {
    throw new Error('InsufficientBalanceToSplitUtxos');
  }

  return {
    inputs: spend.slice(0, selection.inputs).map(utxo => ({
      transaction_id: utxo.transaction_id,
      transaction_vout: utxo.transaction_vout,
    })),
    outputs: selection.outputs,
  };
};
