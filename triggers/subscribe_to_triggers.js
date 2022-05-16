const EventEmitter = require('events');

const asyncUntil = require('async/until');
const {decodeChanId} = require('bolt07');
const {getHeight} = require('ln-service');
const {getInvoices} = require('ln-service');
const {subscribeToGraph} = require('ln-service');
const {subscribeToInvoice} = require('ln-service');
const {subscribeToInvoices} = require('ln-service');
const {subscribeToPeers} = require('ln-service');

const decodeTrigger = require('./decode_trigger');

const defaultInvoicesLimit = 100;
const {keys} = Object;

/** Subscribe to trigger events

  {
    lnds: <Authenticated LND API Object>
  }

  @event 'channel_opened'
  {
    [capacity]: <Channel Token Capacity Number>
    id: <Standard Format Channel Id String>
    public_keys: [<Announcing Public Key>, <Target Public Key String>]
  }

  @event 'peer_connected'
  {
    public_key: <Node Identity Public Key Hex String>
  }

  @event 'peer_disconnected'
  {
    public_key: <Node Identity Public Key Hex String>
  }

  @returns
  <Event Emitter Object>
*/
module.exports = ({lnds}) => {
  const channels = new Set();
  const emitter = new EventEmitter();
  const subs = [];
  const triggers = {};

  // Stop subscription when listeners are removed
  emitter.on('removeListener', () => {
    if (!!emitter.listenerCount('channel_opened')) {
      return;
    }

    return cbk([400, 'RemovedAllListeners']);
  });

  // Clean up when there is an error
  const errored = err => {
    subs.forEach(n => n.removeAllListeners());

    if (!emitter.listenerCount('error')) {
      return;
    }

    return emitter.emit('error', err);
  };

  // Register trigger if present
  const register = ({description, id}, lnd) => {
    try {
      decodeTrigger({encoded: description});
    } catch (err) {
      // Exit early when the invoice is not a trigger invoice
      return;
    }

    triggers[id] = decodeTrigger({encoded: description});

    // Listen for the trigger invoice to be canceled to stop it
    const sub = subscribeToInvoice({id, lnd});

    subs.push(sub);

    // Listen for an error on the invoice
    sub.on('error', err => errored(err));

    // Listen for the trigger to get canceled
    sub.on('invoice_updated', invoice => {
      if (!invoice.is_canceled) {
        return;
      }

      delete triggers[invoice.id];
    });

    return;
  };

  lnds.forEach(lnd => {
    const graphSub = subscribeToGraph({lnd});
    const invoicesSub = subscribeToInvoices({lnd});
    const peersSub = subscribeToPeers({lnd});
    let startHeight;
    let token;

    subs.push(graphSub);
    subs.push(invoicesSub);
    subs.push(peersSub);

    getHeight({lnd}, (err, res) => {
      if (!!err) {
        return errored(err);
      }

      return startHeight = res.current_block_height;
    });

    // Listen for errors on the invoices subscription
    invoicesSub.on('error', err => errored(err));

    // Listen for new trigger invoices
    invoicesSub.on('invoice_updated', updated => register(updated, lnd));

    // Listen for errors on the graph subscription
    graphSub.on('error', err => errored(err));

    // Listen for updates to a channel that may match a trigger
    graphSub.on('channel_updated', (update, cbk) => {
      // Exit early when start height is not known yet
      if (!startHeight) {
        return;
      }

      // Exit early when the channel exists in the set
      if (channels.has(update.id)) {
        return;
      }

      // See if the channel matches a relevant trigger
      const follows = keys(triggers)
        .filter(id => !!triggers[id].follow)
        .filter(id => update.public_keys.includes(triggers[id].follow.id));

      // Exit early when this channel doesn't match any follow trigger
      if (!follows.length) {
        return;
      }

      const height = decodeChanId({channel: update.id}).block_height;

      // Exit early when the channel id is less than the start height
      if (height < startHeight) {
        return;
      }

      // Mark new channel as announced
      channels.add(update.id);

      // This is a new channel that confirmed after the start height
      return emitter.emit('channel_opened', {
        capacity: update.capacity,
        id: update.id,
        public_keys: update.public_keys,
      });
    });

    // Listen for errors on the peers subscription
    peersSub.on('error', err => errored(err));

    // Listen for connected peers subscription
    peersSub.on('connected', (update, cbk) => {
      const id = update.public_key;

      // See if the peer matches a relevant trigger
      const follows = keys(triggers)
        .filter(id => !!triggers[id].connectivity)
        .filter(id => update.public_key === triggers[id].connectivity.id);

      // Exit early when this peer doesn't match any connectivity trigger
      if (!follows.length) {
        return;
      }

      return emitter.emit('peer_connected', update);
    });

    // Listen for disconnected peers subscription
    peersSub.on('disconnected', (update, cbk) => {
      const id = update.public_key;

      // See if the peer matches a relevant trigger
      const follows = keys(triggers)
        .filter(id => !!triggers[id].connectivity)
        .filter(id => update.public_key === triggers[id].connectivity.id);

      // Exit early when this peer doesn't match any connectivity trigger
      if (!follows.length) {
        return;
      }

      return emitter.emit('peer_disconnected', update);
    });

    // Register past trigger invoices
    asyncUntil(
      cbk => cbk(null, token === false),
      cbk => {
        return getInvoices({
          lnd,
          token,
          is_unconfirmed: true,
          limit: !token ? defaultInvoicesLimit : undefined,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          token = res.next || false;

          res.invoices.forEach(invoice => register(invoice, lnd));

          return cbk();
        });
      },
      err => !!err ? errored(err) : null,
    );
  });

  return emitter;
};
