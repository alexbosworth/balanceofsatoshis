const {ceil} = Math;
const flatten = arr => [].concat(...arr);
const inputsCounterVBytesLength = 3;
const inputSequenceVByteLength = 4;
const nestedPublicKeyAddressType = 'np2wpkh';
const nestedPublicKeyVByteLength = 22;
const outputCounterVBytesLength = 1;
const outputValueVBytesLength = 8;
const outputScriptCounterVBytesLength = 1;
const outputScriptVBytesLength = 34;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const transactionIdVByteLength = 32;
const transactionLockTimeVBytesLength = 4;
const transactionOutputIndexVByteLength = 4;
const transactionVersionVBytesLength = 4;
const witnessElementsCounterVByteLength = 0.25;
const witnessPublicKeySizeVByteLength = 0.25;
const witnessPublicKeyVByteLength = 8.25;
const witnessSignatureVByteLength = 18;
const witnessSizeCounterVByteLength = 0.25;

/** Determine balances from components

  {
    channels: [{
      commit_transaction_fee: <Commitment Transaction Fee Tokens Number>
      is_partner_initiated: <Partner Responsible For Chain Fees Bool>
      local_balance: <Local Channel Balance Tokens Number>
      pending_payments: [{
        is_outgoing: <Payment is Sending Out Bool>
        tokens: <Payment Size Tokens Number>
      }]
    }]
    pending: [{
      is_opening: <Channel is Pending Bool>
      is_partner_initiated: <Partner Responsible For Chain Fees Bool>
      local_balance: <Channel Local Balance Tokens Number>
      [pending_payments]: [{
        is_outgoing: <Payment is Sending Out Bool>
        tokens: <Payment Size Tokens Number>
      }]
      [recovered_tokens]: <Already Recovered Balance Tokens Number>
      [transaction_fee]: <Commitment Transaction Fee Tokens Number>
    }]
    transactions: [{
      is_confirmed: <Is Confirmed Bool>
      is_outgoing: <Transaction Outbound Bool>
      output_addresses: [<Address String>]
    }]
    utxos: [{
      address: <Chain Address String>
      address_format: <Chain Address Format String>
      confirmation_count: <Confirmation Count Number>
      tokens: <Unspent Tokens Number>
    }]
  }

  @returns
  {
    closing_balance: <Balance of Tokens Moving Out Of Channels Tokens Number>
    offchain_balance: <Balance of Owned Tokens In Channels Tokens Number>
    offchain_pending: <Total Pending Local Balance Tokens Number>
    onchain_balance: <Balance of Transaction Outputs Number>
    onchain_vbytes: <Estimated Virtual Bytes to Spend On-Chain Funds Number>
  }
*/
module.exports = ({channels, pending, transactions, utxos}) => {
  const channelBalances = channels.map(n => n.local_balance);
  const confirmedUtxos = utxos.filter(n => !!n.confirmation_count);

  // Unconfirmed addresses in outgoing transactions
  const outgoingAddresses = flatten(transactions
    .filter(n => !n.is_confirmed && n.is_outgoing)
    .map(n => n.output_addresses));

  // Unconfirmed change UTXOs
  const changeUtxos = utxos
    .filter(n => !n.confirmation_count)
    .filter(n => outgoingAddresses.includes(n.address));

  // Calculate the local tokens that are still in the process of opening
  const opening = pending
    .filter(n => n.is_partner_initiated === false && n.is_opening)
    .map(n => n.local_balance);

  // Calculate the balances coming back in closing
  const closing = pending
    .filter(n => n.is_closing)
    .map(n => n.local_balance - (n.recovered_tokens || Number()));

  // For in-flight payments assume refund/timeout resolutions will happen
  const channelHtlcs = channels.map(chan => {
    return chan.pending_payments.filter(n => n.is_outgoing).map(n => n.tokens);
  });

  // Some in-flight payments will be in on-chain HTLCs
  const pendingHtlcs = pending
    .map(chan => {
      return (chan.pending_payments || [])
        .filter(n => n.is_outgoing)
        .map(n => n.tokens);
    });

  // Initiator commitment fees are deducted from channel local balances
  const commitFees = channels
    .filter(n => n.is_partner_initiated === false)
    .map(n => n.commit_transaction_fee);

  // Pending channels also have commit transaction fees
  const pendingCommitFees = pending
    .filter(n => n.is_opening && n.is_partner_initiated === false)
    .map(n => n.transaction_fee || Number());

  // Total balance to consider owned on-chain
  const chainBalance = sumOf([]
    .concat(confirmedUtxos)
    .concat(changeUtxos)
    .map(n => n.tokens)
  );

  // Input element virtual bytes
  const inputElements = flatten([]
    .concat(confirmedUtxos)
    .concat(changeUtxos)
    .map(utxo => {
      const inputData = []
        .concat(transactionIdVByteLength) // Previous outpoint tx id
        .concat(transactionOutputIndexVByteLength) // Previous tx out index
        .concat(inputSequenceVByteLength) // Input sequence number
        .concat(witnessElementsCounterVByteLength) // Witness elements count
        .concat(witnessSizeCounterVByteLength) // Witness sig size counter
        .concat(witnessSignatureVByteLength) // Witness signature
        .concat(witnessPublicKeySizeVByteLength) // Public key size counter
        .concat(witnessPublicKeyVByteLength); // Witness public key

      // Exit early with nested data
      if (utxo.address_format === nestedPublicKeyAddressType) {
        return inputData.concat(nestedPublicKeyVByteLength);
      }

      return inputData;
    }));

  // Total balance to consider owned in channels
  const channelBalance = sumOf(flatten([]
    .concat(channelBalances)
    .concat(commitFees)
    .concat(flatten(channelHtlcs))
  ));

  // Total pending balance to consider owned
  const pendingBalance = sumOf(flatten([]
    .concat(opening)
    .concat(pendingCommitFees)
    .concat(flatten(pendingHtlcs))
  ));

  // Estimate the virtual bytes size of a tx that spends all inputs
  const vbyteComponents = !inputElements.length ? [] : flatten([]
    .concat(transactionVersionVBytesLength)
    .concat(inputsCounterVBytesLength)
    .concat(outputCounterVBytesLength)
    .concat(outputValueVBytesLength)
    .concat(outputScriptCounterVBytesLength)
    .concat(outputScriptVBytesLength)
    .concat(transactionLockTimeVBytesLength)
    .concat(inputElements));

  return {
    closing_balance: sumOf(closing),
    offchain_balance: channelBalance,
    offchain_pending: pendingBalance,
    onchain_balance: chainBalance,
    onchain_vbytes: ceil(sumOf(vbyteComponents)),
  };
};
