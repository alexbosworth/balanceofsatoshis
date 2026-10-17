const {equal} = require('node:assert').strict;
const test = require('node:test');

const asyncRetry = require('async/retry');
const {closeChannel} = require('ln-service');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {createChainAddress} = require('ln-service');
const {deleteChainTransaction} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {setupChannel} = require('ln-docker-daemons');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {getChannelCloses} = require('./../../chain');

const capacity = 1e6;
const giveTokens = 1e5;
const interval = 200;
const size = 2;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const times = 1000;

// Closes that pay out to outside of the wallet should still have their fees
test(`Get channel closes that pay outside the wallet`, async () => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [{generate, lnd}, target] = nodes;

  try {
    const channel = await setupChannel({
      capacity,
      generate,
      lnd,
      give_tokens: giveTokens,
      to: target,
    });

    // The close pays the local balance to an address outside of the wallet
    const {address} = await createChainAddress({lnd: target.lnd});

    const closing = await asyncRetry({interval, times}, async () => {
      return await closeChannel({address, lnd, id: channel.id});
    });

    // Wait for the close to confirm
    await asyncRetry({interval, times}, async () => {
      await generate({});

      const {channels} = await getClosedChannels({lnd});

      const closed = channels.find(n => {
        return n.close_transaction_id === closing.transaction_id;
      });

      if (!closed || !closed.close_confirm_height) {
        throw new Error('WaitingForChannelCloseConfirmation');
      }
    });

    // LND stores a tx that it publishes as an unconfirmed wallet tx, even when
    // none of its outputs are in the wallet. The wallet does not watch for the
    // confirmation of such a tx so it stays unconfirmed, remove it so that the
    // close tx must be looked up from outside of the wallet
    const published = await getChainTransactions({lnd});

    const isCloseInWallet = !!published.transactions.find(transaction => {
      return transaction.id === closing.transaction_id;
    });

    if (isCloseInWallet) {
      await deleteChainTransaction({lnd, id: closing.transaction_id});
    }

    // The close tx is not a wallet tx, getting closes has to look it up
    const {transactions} = await getChainTransactions({lnd});

    const walletCloseTx = transactions.find(transaction => {
      return transaction.id === closing.transaction_id;
    });

    equal(walletCloseTx, undefined, 'Close tx is not in the wallet');

    // The peer has the close tx since it was paid both outputs
    const peerCloseTx = await asyncRetry({interval, times}, async () => {
      const peerTxs = await getChainTransactions({lnd: target.lnd});

      const found = peerTxs.transactions.find(transaction => {
        return transaction.id === closing.transaction_id;
      });

      if (!found) {
        throw new Error('WaitingForPeerToSeeCloseTx');
      }

      return found;
    });

    // The close fee is the capacity not paid out in the close tx outputs
    const {outputs} = componentsOfTransaction({
      transaction: peerCloseTx.transaction,
    });

    const fee = capacity - sumOf(outputs.map(n => n.tokens));

    const [details] = (await getChannelCloses({lnd})).closes;

    equal(details.channel_close, closing.transaction_id, 'Got the close');
    equal(details.closing_fee_paid, fee, 'Got closing fee paid');
    equal(details.is_closing_fee_unknown, undefined, 'Closing fee is known');
  } catch (err) {
    equal(err, null, 'Expected no error');
  } finally {
    await kill({});
  }
});
