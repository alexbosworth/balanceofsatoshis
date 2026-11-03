const {createHash} = require('node:crypto');
const {equal} = require('node:assert').strict;
const test = require('node:test');

const asyncEach = require('async/each');
const asyncRetry = require('async/retry');
const {createInvoice} = require('ln-service');
const {getChannel} = require('ln-service');
const {getInvoices} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {setupChannel} = require('ln-docker-daemons');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {streamPayment} = require('./../../network');

const callbackUrl = 'https://example.com/callback';
const capacity = 1e6;
const interval = 1000;
const log = () => {};
const maxFee = '10000';
const maxFeeRate = 1000;
const maxSendable = 1e6;
const metadata = '[["text/plain","streaming"]]';
const minSendable = 1;
const minStreamPayment = 100000;
const sha256 = n => createHash('sha256').update(n).digest('hex');
const size = 2;
const sumOf = arr => arr.reduce((sum, n) => sum + BigInt(n), BigInt(Number()));
const termsUrl = 'https://example.com/.well-known/lnurlp/bob';
const times = 300;
const tokens = 1200000;
const uncolored = n => n.replace(/\u001b\[\d+m/g, String());

// Amounts are shown in BTC, and they can be wrapped in color codes
const tokensFromDisplay = n => Math.round(Number(uncolored(n)) * 1e8);

// Streaming a payment to a service should pay more than one route can carry
test('Stream a payment to a lnurl service in several payments', async () => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [alice, bob] = nodes;

  try {
    // Alice has two channels to Bob, neither can carry the total on its own
    const channels = [
      await setupChannel({
        capacity,
        generate: alice.generate,
        lnd: alice.lnd,
        to: bob,
      }),
      await setupChannel({
        capacity,
        generate: alice.generate,
        lnd: alice.lnd,
        to: bob,
      }),
    ];

    // Wait for the graph to be synced and both policies of both channels
    await asyncRetry({interval, times}, async () => {
      await asyncEach(nodes, async ({lnd}) => {
        const wallet = await getWalletInfo({lnd});

        if (!wallet.is_synced_to_chain || !wallet.is_synced_to_graph) {
          throw new Error('WaitingForSync');
        }
      });

      await asyncEach(channels, async ({id}) => {
        const {policies} = await getChannel({id, lnd: alice.lnd});

        if (!!policies.find(n => n.cltv_delta === undefined)) {
          throw new Error('WaitingForBothChannelPolicies');
        }
      });
    });

    const hash = sha256(Buffer.from(metadata, 'utf8'));

    // Bob is the lnurl service, making an invoice for every amount requested
    const request = ({qs, url}, cbk) => {
      // Exit early when asked for the terms of the service
      if (url === termsUrl) {
        return cbk(null, {}, {
          metadata,
          callback: callbackUrl,
          maxSendable: maxSendable * 1e3,
          minSendable,
          tag: 'payRequest',
        });
      }

      return createInvoice({
        description_hash: hash,
        lnd: bob.lnd,
        mtokens: qs.amount,
      },
      (err, res) => {
        if (!!err) {
          return cbk(err);
        }

        return cbk(null, {}, {pr: res.request});
      });
    };

    const paid = await streamPayment({
      request,
      amount: tokens.toString(),
      avoid: [],
      fs: {getFile: (path, cbk) => cbk()},
      lnd: alice.lnd,
      lnurl: 'bob@example.com',
      logger: {error: log, info: log, warn: log},
      max_fee: maxFee,
      max_fee_rate: maxFeeRate,
      out: [],
    });

    equal(paid.payments.length > 1, true, 'Paid in a series of payments');

    const totalPaid = tokensFromDisplay(paid.total_paid);

    // Everything but a remainder below the minimum payment should be paid
    equal(tokens - totalPaid < minStreamPayment, true, 'Paid nearly all');

    // Bob should have received everything that was paid
    const {invoices} = await getInvoices({lnd: bob.lnd});

    const received = sumOf(
      invoices.filter(n => !!n.is_confirmed).map(n => n.received_mtokens)
    );

    equal(received.toString(), BigInt(totalPaid * 1e3).toString(), 'Received');
  } finally {
    await kill({});
  }
});
