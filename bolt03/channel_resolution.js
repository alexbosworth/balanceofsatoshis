const isOfferedHtlcOutput = require('./is_offered_htlc_output');
const isReceivedHtlcOutput = require('./is_received_htlc_output');
const isToLocalOutput = require('./is_to_local_output');

const {preimageByteLength} = require('./constants');
const {publicKeyByteLength} = require('./constants');

const sigLen = 69;

/** Channel resolution details from witness

  {
    witness: [<Witness Hex String>]
  }

  @returns
  {
    [type]: <Channel Resolution Type String>
  }
*/
module.exports = ({witness}) => {
  const [program] = witness.slice().reverse();

  if (Buffer.from(program, 'hex').length === publicKeyByteLength) {
    return {type: 'p2wpkh'};
  }

  if (isOfferedHtlcOutput({program})) {
    const [p1, p2, p3, p4] = witness.map(n => Buffer.from(n, 'hex').length);

    if (!p1 && p2 > sigLen && p3 > sigLen && !p4) {
      return {type: 'offered_htlc_timeout'};
    }

    if (p1 > sigLen && p2 === preimageByteLength && !p4) {
      return {type: 'offered_htlc_settled'};
    }

    return {type: 'offered_htlc'};
  }

  if (isReceivedHtlcOutput({program})) {
    const [p1, p2, p3, p4] = witness.map(n => Buffer.from(n, 'hex').length);

    if (p1 > sigLen && !p2) {
      return {type: 'received_htlc_timeout'};
    }

    if (!p1 && p2 > sigLen && p3 > sigLen && p4 === preimageByteLength) {
      return {type: 'received_htlc_settled'};
    }

    if (p1 > sigLen && p2 === publicKeyByteLength) {
      return {type: 'received_htlc_breach'};
    }

    return {type: 'received_htlc'};
  }

  if (isToLocalOutput({program})) {
    const [p1, p2] = witness.map(n => Buffer.from(n, 'hex').length);

    if (p1 > sigLen && !p2.length) {
      return {type: 'csv_delayed'};
    }

    return {type: 'to_local_breach'};
  }

  return {type: 'unknown'};
};
