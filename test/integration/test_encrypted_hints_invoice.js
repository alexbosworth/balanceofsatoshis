const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const test = require('node:test');

const asyncEach = require('async/each');
const asyncRetry = require('async/retry');
const {getInvoice} = require('ln-service');
const {getNode} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {parsePaymentRequest} = require('ln-service');
const {setupChannel} = require('ln-docker-daemons');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {createInvoice} = require('./../../offchain');
const {pay} = require('./../../network');
const {probe} = require('./../../network');

const blindedPathsFeatureBit = 262;
const interval = 1000;
const introductionNode = 'introduction_node';
const log = () => {};
const maxFee = 1000;
const payTimes = 10;
const size = 4;
const times = 300;
const tokens = 100000;

// Probing and paying an invoice with a selected blinded path should succeed
test(`Probe and pay to an encrypted hints invoice`, async () => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [alice, bob, carol, dave] = nodes;

  try {
    // Alice -> Bob -> Carol -> Dave
    await setupChannel({generate: alice.generate, lnd: alice.lnd, to: bob});
    await setupChannel({generate: bob.generate, lnd: bob.lnd, to: carol});
    await setupChannel({generate: carol.generate, lnd: carol.lnd, to: dave});

    // Wait for the graph to be synced at the payer and at the receiver
    await asyncRetry({interval, times}, async () => {
      await asyncEach([alice, dave], async ({lnd}) => {
        const wallet = await getWalletInfo({lnd});

        if (!wallet.is_synced_to_chain || !wallet.is_synced_to_graph) {
          throw new Error('WaitingForSync');
        }

        // Carol should be seen with her channels to Bob and to Dave
        const {channels} = await getNode({lnd, public_key: carol.id});

        if (channels.length !== 2) {
          throw new Error('WaitingForCarolChannelsInGraph');
        }
      });
    });

    const prompts = [];

    // Dave walks outwards: peer Carol, then Bob, then Bob is the introduction
    const ask = ({message, source}, cbk) => {
      const choices = source();

      prompts.push(message);

      switch (prompts.length) {
      case 1:
        return cbk({id: choices.find(n => n.description === carol.id).value});

      case 2:
        return cbk({id: choices.find(n => n.description === bob.id).value});

      default:
        return cbk({id: introductionNode});
      }
    };

    const invoice = await createInvoice({
      ask,
      amount: tokens.toString(),
      description: 'encrypted hints',
      is_encrypting_hints: true,
      is_selecting_hops: true,
      lnd: dave.lnd,
      logger: {error: log, info: log},
      request: () => {},
    });

    const {request} = invoice.request;

    const details = parsePaymentRequest({request});

    equal(prompts.length, 3, 'Path selection asked for peer, hop and end');
    equal(details.destination !== dave.id, true, 'Dave is not the destination');
    equal(details.payment, undefined, 'Payment identifier is in the path');
    equal(details.tokens, tokens, 'Request is for the invoice amount');

    const [path] = details.paths;

    equal(details.paths.length, 1, 'A single blinded path is in the request');
    equal(path.introduction_node, bob.id, 'Bob is the introduction node');
    equal(path.hops.length, 4, 'The path goes Bob, Carol, Dave and padding');

    // Every hop after the introduction node is a blinded hop
    const blindedHops = path.hops.slice(1).map(() => 'blinded');

    deepEqual(
      details.features.map(n => n.bit).includes(blindedPathsFeatureBit),
      true,
      'The blinded paths feature bit is set'
    );

    const logs = [];
    const logger = {error: log, info: line => logs.push(line)};

    // Alice probes the request, finding a route to the introduction node
    const probed = await asyncRetry({interval, times: payTimes}, async () => {
      return await probe({
        logger,
        request,
        avoid: [],
        lnd: alice.lnd,
        max_fee: maxFee,
        max_paths: 1,
        out: [],
      });
    });

    const decoded = logs.find(n => n.destination === 'blinded');
    const checking = logs.find(n => !!n.checking_for_path_to_introduction);

    equal(!!decoded, true, 'The request destination is logged as blinded');
    equal(decoded.tokens, tokens, 'The request amount is logged');

    equal(
      checking.checking_for_path_to_introduction.endsWith(bob.id),
      true,
      'The probe is logged as going to the introduction node'
    );

    equal(checking.blinded_path_fee !== undefined, true, 'Path fee logged');

    equal(probed.total_fee !== undefined, true, 'The probe found a fee');
    equal(probed.blinded_path_fee <= probed.total_fee, true, 'Path fee in fee');
    equal(probed.probed, tokens, 'The probe delivers the invoice amount');
    deepEqual(probed.success.slice(1), blindedHops, 'Blinded hops probed');
    equal(probed.relays.length, path.hops.length, 'Route covers the path');
    equal(probed.relays[0], bob.id, 'The route goes to Bob first');

    // Alice pays the request through the blinded path
    const paid = await asyncRetry({interval, times: payTimes}, async () => {
      return await pay({
        logger,
        request,
        avoid: [],
        lnd: alice.lnd,
        max_fee: maxFee,
        max_paths: 1,
        out: [],
      });
    });

    equal(paid.id, details.id, 'The payment is for the invoice hash');
    equal(paid.paid, tokens + paid.total_fee, 'Amount plus total fee paid');
    equal(!!paid.preimage, true, 'The payment preimage was received');
    deepEqual(paid.success.slice(1), blindedHops, 'Paid through blinded hops');

    const settled = await getInvoice({id: details.id, lnd: dave.lnd});

    equal(settled.is_confirmed, true, 'Dave received the payment');
    equal(settled.received, tokens, 'Dave received the invoice amount');
  } catch (err) {
    deepEqual(err, null, 'Expected no error');
  }

  await kill({});

  return;
});
