const {Transaction} = require('bitcoinjs-lib');

const {fromHex} = Transaction;
const idFromHash = hash => hash.reverse().toString('hex');

/** Transaction records from parents of an original transaction

  {
    ended: [{
      capacity: <Closed Channel Capacity Tokens Number>
      [close_transaction_id]: <Closing Transaction Id Hex String>
      final_local_balance: <Channel Close Final Local Balance Tokens Number>
      final_time_locked_balance: <Closed Channel Timelocked Tokens Number>
      [id]: <Closed Standard Format Channel Id String>
      is_cooperative_close: <Is Cooperative Close Bool>
      is_local_force_close: <Is Local Force Close Bool>
      is_remote_force_close: <Is Remote Force Close Bool>
      partner_public_key: <Partner Public Key Hex String>
      transaction_id: <Channel Funding Transaction Id Hex String>
      transaction_vout: <Channel Funding Output Index Number>
    }]
    id: <Transaction Id Hex String>
    original: <Original Transaction Id Hex String>
    pending: [{
      [close_transaction_id]: <Channel Closing Transaction Id String>
      is_closing: <Channel Is Closing Bool>
      [is_partner_initiated]: <Channel Partner Initiated Channel Bool>
      local_balance: <Channel Local Tokens Balance Number>
      partner_public_key: <Channel Peer Public Key String>
      [pending_balance]: <Tokens Pending Recovery Number>
      [recovered_tokens]: <Tokens Recovered From Close Number>
      [timelock_expiration]: <Pending Tokens Block Height Timelock Number>
      [transaction_fee]: <Funding Transaction Fee Tokens Number>
      transaction_id: <Channel Funding Transaction Id String>
      transaction_vout: <Channel Funding Transaction Vout Number>
      [transaction_weight]: <Funding Transaction Weight Number>
    }]
    txs: [{
      [block_id]: <Block Hash String>
      [confirmation_count]: <Confirmation Count Number>
      [confirmation_height]: <Confirmation Block Height Number>
      created_at: <Created ISO 8601 Date String>
      [fee]: <Fees Paid Tokens Number>
      id: <Transaction Id String>
      is_confirmed: <Is Confirmed Bool>
      is_outgoing: <Transaction Outbound Bool>
      output_addresses: [<Address String>]
      tokens: <Tokens Including Fee Number>
      [transaction]: <Raw Transaction Hex String>
    }]
    vout: <Spent Transaction Output Index>
  }

  @returns
  {
    records: [{
      action: <Channel Action String>
      [balance]: <Channel Balance Tokens Number>
      [capacity]: <Channel Capacity Value Number>
      [channel]: <Channel Standard Format Id String>
      [close_tx]: <Channel Closing Transaction Id Hex String>
      [open_tx]: <Channel Opening Transaction Id Hex String>
      [timelock]: <Channel Funds Timelocked Until Height Number>
      with: <Channel Peer Public Key Hex String>
    }]
  }
*/
module.exports = ({ended, id, original, pending, txs, vout}) => {
  const records = [];
  const spendClosing = pending.find(n => n.close_transaction_id === id);
  const spendTx = txs.find(tx => tx.id === id);

  const spendPending = pending.filter(chan => {
    return chan.transaction_id === id && chan.transaction_vout === vout;
  });

  if (!!spendPending.length) {
    spendPending
      .filter(pending => !!pending.is_closing)
      .forEach(pending => {
        return records.push({
          action: 'channel_closing',
          balance: pending.pending_balance,
          timelock: pending.timelock_expiration,
          with: pending.partner_public_key,
        });
      });
  }

  if (!!spendClosing && spendClosing.is_partner_initiated) {
    records.push({
      action: 'peer_force_closing_channel',
      balance: spendClosing.pending_balance,
      timelock: spendClosing.timelock_expiration,
      with: spendClosing.partner_public_key,
    });
  }

  if (!!spendTx) {
    fromHex(spendTx.transaction).ins.forEach(input => {
      const grandParentTx = txs.find(n => n.id === original);

      if (!grandParentTx) {
        return;
      }

      return fromHex(grandParentTx.transaction).ins.forEach(grandIn => {
        const grandTx = txs.find(n => n.id === idFromHash(grandIn.hash));

        if (!grandTx) {
          return;
        }

        return fromHex(grandTx.transaction).ins.forEach(greatIn => {
          const greatTx = txs.find(n => n.id === idFromHash(greatIn.hash));

          const closingTime = ended.find(chan => {
            return chan.close_transaction_id === idFromHash(greatIn.hash);
          });

          if (!!closingTime && closingTime.is_local_force_close) {
            records.push({
              action: 'force_closed_channel',
              balance: closingTime.final_time_locked_balance,
              capacity: closingTime.capacity,
              channel: closingTime.id,
              close_tx: closingTime.close_transaction_id,
              open_tx: closingTime.transaction_id,
              with: closingTime.partner_public_key,
            });
          }
        });
      });
    });
  }

  const spendClose = ended.find(n => n.close_transaction_id === id);

  // Exit early when there is no spend of a closed channel
  if (!spendClose) {
    return {records};
  }

  if (!!spendClose.is_cooperative_close) {
    records.push({
      action: 'cooperatively_closed_channel',
      balance: spendClose.final_local_balance,
      capacity: spendClose.capacity,
      channel: spendClose.id,
      close_tx: spendClose.close_transaction_id,
      open_tx: spendClose.transaction_id,
      with: spendClose.partner_public_key,
    });
  }

  if (!!spendClose.is_local_force_close) {
    const balance = spendClose.final_time_locked_balance;

    records.push({
      action: 'force_closed_channel',
      balance: balance || spendClose.final_local_balance,
      capacity: spendClose.capacity,
      channel: spendClose.id,
      close_tx: spendClose.close_transaction_id,
      open_tx: spendClose.transaction_id,
      with: spendClose.partner_public_key,
    });
  }

  if (!!spendClose.is_remote_force_close) {
    records.push({
      action: 'peer_force_closed_channel',
      balance: spendClose.final_local_balance,
      capacity: spendClose.capacity,
      channel: spendClose.id,
      close_tx: spendClose.close_transaction_id,
      open_tx: spendClose.transaction_id,
      with: spendClose.partner_public_key,
    });
  }

  return {records};
};
