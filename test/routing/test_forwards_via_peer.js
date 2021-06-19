const {test} = require('@alexbosworth/tap');

const forwardsViaPeer = require('./../../routing/forwards_via_peer');

const tests = [
  {
    args: {
      forwards: [
        {incoming_channel: '1x1x1'},
        {outgoing_channel: '2x2x2'},
        {incoming_channel: '3x3x3'},
      ],
      private_channels: [{id: '1x1x1', partner_public_key: 'a'}],
      public_channels: [{id: '2x2x2'}],
      via: 'a',
    },
    description: 'Forwards via peer are filtered for',
    expected: {
      forwards: [{incoming_channel: '1x1x1'}, {outgoing_channel: '2x2x2'}],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, ({end, equal, strictSame, throws}) => {
    if (!!error) {
      throws(() => forwardsViaPeer(args), new Error(error), 'Got error');
    } else {
      const {forwards} = forwardsViaPeer(args);

      strictSame(forwards, expected.forwards, 'Forwards are returned');
    }

    return end();
  });
});
