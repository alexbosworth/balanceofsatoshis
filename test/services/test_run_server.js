const {createHash} = require('node:crypto');
const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const EventEmitter = require('node:events');
const {match} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

const asyncRetry = require('async/retry');
const {createSupportOffer} = require('paid-services');
const {parseOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');
const qrcode = require('qrcode-terminal');

const {getInfoResponse} = require('./../fixtures');
const {getNodeInfoResponse} = require('./../fixtures');
const {listChannelsResponse} = require('./../fixtures');
const {listPeersResponse} = require('./../fixtures');
const {runServer} = require('./../../services');

const clone = n => JSON.parse(JSON.stringify(n));
const ended = [503, 'SupportOfferServiceEnded'];
const hashOf = n => createHash('sha256').update(n).digest();
const interval = 10;
const issuerKeyIndex = 1;
const messagesEnded = [503, 'NetworkMessagesSubscriptionEnded'];
const relayFeature = {39: {is_known: true, is_required: false, name: 'msgs'}};
const signature = Buffer.alloc(64);
const times = 100;
const unsupported = {details: 'unknown method SubscribeOnionMessages'};
const unsupportedError = [501, 'SubscribeOnionMessagesMethodUnsupported'];

// End the service: a messages stream that ends is subscribed to again, but
// LND without onion messages ends the service
const endService = ({messages}) => messages.emit('error', unsupported);

// A key of a node is derived from the seed of the node and the key locator
const keyFor = ({family, index, seed}) => {
  return Buffer.from(pointFromScalar(hashOf(`${seed}/${family}/${index}`)));
};

// A logger that keeps what is logged
const makeLogger = () => {
  const errors = [];
  const info = [];

  return {
    errors,
    info,
    logger: {error: n => errors.push(n), info: n => info.push(n)},
  };
};

// A subscription stream that can be canceled
const makeStream = () => {
  const stream = new EventEmitter();

  stream.cancel = () => {};

  return stream;
};

// An LND that derives keys from a seed, and keeps the requests to sign
// A node has a public channel, or only a private channel with a public peer
const makeLnd = ({messages, peer, seed, signed}) => {
  const [channel] = listChannelsResponse.channels;
  const [connected] = listPeersResponse.peers;

  return {
    default: {
      getInfo: ({}, cbk) => cbk(null, clone(getInfoResponse)),
      getNodeInfo: (args, cbk) => cbk(null, {
        ...getNodeInfoResponse,
        channels: [],
        node: {...getNodeInfoResponse.node, pub_key: args.pub_key},
        num_channels: 2,
      }),
      listChannels: ({}, cbk) => {
        // Exit early when the node has a public channel
        if (!peer) {
          return cbk(null, clone(listChannelsResponse));
        }

        return cbk(null, {
          channels: [{...channel, private: true, remote_pubkey: peer}],
        });
      },
      listPeers: ({}, cbk) => cbk(null, {
        peers: [{...connected, features: relayFeature, pub_key: peer}],
      }),
      subscribeInvoices: ({}) => makeStream(),
      subscribeOnionMessages: ({}) => messages || makeStream(),
    },
    signer: {
      deriveSharedKey: (args, cbk) => {
        const family = args.key_loc.key_family;
        const index = args.key_loc.key_index;
        const partner = args.ephemeral_pubkey.toString('hex');

        return cbk(null, {
          shared_key: hashOf(`${seed}/${family}/${index}/${partner}`),
        });
      },
      signMessage: (args, cbk) => {
        (signed || []).push(args);

        return cbk(null, {signature});
      },
    },
    wallet: {
      deriveKey: (args, cbk) => {
        return cbk(null, {
          key_loc: {key_index: args.key_index},
          raw_key_bytes: keyFor({
            seed,
            family: args.key_family,
            index: args.key_index,
          }),
        });
      },
      deriveNextKey: (args, cbk) => {
        return cbk(null, {
          key_loc: {key_index: issuerKeyIndex},
          raw_key_bytes: keyFor({
            seed,
            family: args.key_family,
            index: issuerKeyIndex,
          }),
        });
      },
    },
  };
};

// Wait for a condition to be met
const waitFor = condition => {
  return asyncRetry({interval, times}, cbk => {
    return cbk(!condition() ? [503, 'ExpectedConditionToBeMet'] : null);
  });
};

const tests = [
  {
    args: {logger: makeLogger().logger},
    description: 'An LND is required to run a server',
    error: [400, 'ExpectedAuthenticatedLndToRunServer'],
  },
  {
    args: {lnd: makeLnd({seed: 'node'})},
    description: 'A logger is required to run a server',
    error: [400, 'ExpectedWinstonLoggerToRunServer'],
  },
  {
    args: {
      lnd: makeLnd({seed: 'node'}),
      logger: makeLogger().logger,
      record: 'record',
    },
    description: 'A service record is hex',
    error: [400, 'ExpectedHexServiceRecordToResumeService'],
  },
];

tests.forEach(({args, description, error}) => {
  return test(description, async () => {
    await rejects(runServer(args), error, 'Got expected error');

    return;
  });
});

test('A failure to make a support offer is returned', async () => {
  const {errors, info, logger} = makeLogger();
  const lnd = makeLnd({seed: 'node'});

  lnd.wallet.deriveNextKey = ({}, cbk) => cbk('err');

  await rejects(
    runServer({lnd, logger}),
    [503, 'UnexpectedErrGettingPublicKeyFromSeed'],
    'Got error making support offer'
  );

  deepEqual(errors, [], 'No service errors without a support offer');
  deepEqual(info, [], 'No support offer is shown');

  return;
});

test('A new support offer is made and run until it ends', async () => {
  const {errors, info, logger} = makeLogger();
  const messages = makeStream();
  const signed = [];

  const running = runServer({
    logger,
    lnd: makeLnd({messages, signed, seed: 'node'}),
  });

  // The offer is shown once the service has checked its record
  await waitFor(() => !!info.length);

  equal(signed.length, 1, 'The support record is checked');
  deepEqual(errors, [], 'No errors running a new support offer');

  const [shown, ...more] = info;

  deepEqual(more, [], 'The support offer is shown once');
  match(shown.public_offer, /^lno1/, 'Got BOLT 12 public offer');
  equal(shown.qr, undefined, 'No QR code of the offer without asking');
  match(shown.service_record, /^626f73ff/, 'Got service record');

  const [path] = parseOffer({offer: shown.public_offer}).paths;
  const self = keyFor({family: 6, index: 0, seed: 'node'}).toString('hex');

  equal(path.introduction_node, self, 'A public node starts the offer path');

  endService({messages});

  await rejects(running, ended, 'The server stops when the service ends');

  deepEqual(
    errors,
    [{err: unsupportedError}, {err: messagesEnded}],
    'Got reason service ended'
  );

  return;
});

test('A private node starts the offer path at a public peer', async () => {
  const {errors, info, logger} = makeLogger();
  const messages = makeStream();
  const peer = keyFor({family: 6, index: 0, seed: 'peer'}).toString('hex');
  const signed = [];

  const running = runServer({
    logger,
    lnd: makeLnd({messages, peer, signed, seed: 'node'}),
  });

  // The offer is shown once the service has checked its record
  await waitFor(() => !!info.length);

  const [shown] = info;
  const [path] = parseOffer({offer: shown.public_offer}).paths;

  equal(path.introduction_node, peer, 'The offer path starts at the peer');
  deepEqual(errors, [], 'No errors running the offer of a private node');

  endService({messages});

  await rejects(running, ended, 'The server stops when the service ends');

  return;
});

test('A QR code of the offer is shown when asked for', async () => {
  const {errors, info, logger} = makeLogger();
  const messages = makeStream();

  const running = runServer({
    logger,
    is_including_qr: true,
    lnd: makeLnd({messages, seed: 'node'}),
  });

  // The offer is shown once the service has checked its record
  await waitFor(() => !!info.length);

  const [shown] = info;
  const url = `lightning:${shown.public_offer}`;

  const code = await new Promise(resolve => {
    return qrcode.generate(url, {small: true}, resolve);
  });

  equal(shown.qr, code, 'Got QR code of the offer');
  deepEqual(errors, [], 'No errors showing a QR code of the offer');

  endService({messages});

  await rejects(running, ended, 'The server stops when the service ends');

  return;
});

test('A support offer is resumed from its service record', async () => {
  const {errors, info, logger} = makeLogger();
  const messages = makeStream();
  const signed = [];

  const lnd = makeLnd({messages, signed, seed: 'node'});

  const {offer, record} = await createSupportOffer({lnd});

  const running = runServer({lnd, logger, record});

  // The offer is shown once the support record is checked
  await waitFor(() => !!info.length);

  equal(signed.length, 1, 'The support record is checked');
  deepEqual(errors, [], 'No errors resuming a support offer');

  const [shown, ...more] = info;

  deepEqual(more, [], 'The resumed offer is shown once');
  equal(shown.public_offer, offer, 'The resumed offer is shown');
  equal(shown.service_record, undefined, 'The record is not shown again');

  endService({messages});

  await rejects(running, ended, 'The server stops when the service ends');

  deepEqual(
    errors,
    [{err: unsupportedError}, {err: messagesEnded}],
    'Got reason service ended'
  );

  return;
});

test('A support offer of another node is not resumed', async () => {
  const {errors, info, logger} = makeLogger();
  const signed = [];

  const {record} = await createSupportOffer({lnd: makeLnd({seed: 'other'})});

  await rejects(
    runServer({logger, record, lnd: makeLnd({signed, seed: 'node'})}),
    ended,
    'The server stops when the service ends'
  );

  deepEqual(
    errors,
    [{err: [400, 'ExpectedServiceRecordMadeByThisNode']}],
    'Got reason service ended'
  );

  deepEqual(info, [], 'No offer is shown for a record of another node');
  deepEqual(signed, [], 'Nothing is signed for another node');

  return;
});
