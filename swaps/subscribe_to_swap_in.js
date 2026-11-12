const EventEmitter = require('events');

const {subscribeToSwapInStatus} = require('goldengate');

const {swapInEventsMinAliveMs} = require('./constants');
const {swapInEventsRetryMs} = require('./constants');
const {swapInEventsRetryStepMs} = require('./constants');

const events = ['coop_settlement', 'risk_accepted', 'risk_rejected'];
const streamError = 'UnexpectedSwapInStatusSubscriptionError';

/** Subscribe to swap in events, subscribing again when the stream ends

  {
    metadata: <Authentication Metadata Object>
    service: <Swap Service Object>
  }

  @throws
  <Error Object>

  @returns
  <EventEmitter Object>

  @event 'coop_settlement'
  {
    id: <Swap Hash Hex String>
    nonces: [{
      nonce: <Service MuSig2 Public Nonce Hex String>
      transaction_id: <Utxo Transaction Id Hex String>
      transaction_vout: <Utxo Transaction Output Index Number>
    }]
    prevouts: [{
      script: <Spending Output Script Hex String>
      tokens: <Spending Output Tokens Number>
      transaction_id: <Spending Transaction Id Hex String>
      transaction_vout: <Spending Transaction Output Index Number>
    }]
    psbt: <Settlement Transaction PSBT Hex String>
  }

  @event 'error'
  <Error Object>

  @event 'risk_accepted'
  {
    id: <Swap Hash Hex String>
  }

  @event 'risk_rejected'
  {
    id: <Swap Hash Hex String>
  }
*/
module.exports = ({metadata, service}) => {
  const emitter = new EventEmitter();
  const stream = {attempts: 0};

  const emitError = err => {
    // Exit early when there are no error listeners
    if (!emitter.listenerCount('error')) {
      return;
    }

    return emitter.emit('error', err);
  };

  // Subscribe to the swap in status and relay its events
  const subscribe = () => {
    const sub = subscribeToSwapInStatus({metadata, service});

    // A stream that stays up for a while starts the delays over
    stream.stable = setTimeout(() => {
      stream.attempts = 0;

      return;
    },
    swapInEventsMinAliveMs);

    // Subscribe again after a delay that grows while the stream keeps failing
    const resubscribe = () => {
      clearTimeout(stream.stable);

      sub.removeAllListeners();

      // Exit early when the events are no longer listened to
      if (!!stream.is_stopped) {
        return;
      }

      const extraMs = stream.attempts * swapInEventsRetryStepMs;

      stream.attempts += 1;

      stream.timer = setTimeout(subscribe, swapInEventsRetryMs + extraMs);

      return;
    };

    events.forEach(event => {
      return sub.on(event, details => emitter.emit(event, details));
    });

    sub.on('end', () => resubscribe());

    sub.on('error', err => {
      const [, message] = err;

      emitError(err);

      // Exit early when the error is about a notification, the stream is up
      if (message !== streamError) {
        return;
      }

      return resubscribe();
    });

    stream.sub = sub;

    return;
  };

  // Stop the stream when nothing is listening to its events anymore
  emitter.on('removeListener', () => {
    // Exit early when there are still listeners for events
    if (events.some(event => !!emitter.listenerCount(event))) {
      return;
    }

    // Exit early when there is still a listener for errors
    if (!!emitter.listenerCount('error')) {
      return;
    }

    stream.is_stopped = true;

    clearTimeout(stream.stable);
    clearTimeout(stream.timer);

    return stream.sub.removeAllListeners();
  });

  subscribe();

  return emitter;
};
