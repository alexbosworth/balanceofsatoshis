const connectToPeer = require('./connect_to_peer');
const findTagMatch = require('./find_tag_match');
const interceptInboundChannels = require('./intercept_inbound_channels');
const limitForwarding = require('./limit_forwarding');
const openChannels = require('./open_channels');

module.exports = {
  connectToPeer,
  findTagMatch,
  interceptInboundChannels,
  limitForwarding,
  openChannels,
};
