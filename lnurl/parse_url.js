const {bech32} = require('bech32');

const asLnurl = n => n.substring(n.startsWith('lightning:') ? 10 : 0);
const bech32CharLimit = 2000;
const {decode} = bech32;
const isEmail = n => /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/.test(n);
const isOnion = n => /.onion$/.test(n);
const isUsername = n => /^[a-z0-9_.]*$/.test(n);
const join = arr => arr.join('');
const parseEmail = email => email.split('@');
const prefix = 'lnurl';
const sslProtocol = 'https://';
const urlString = '/.well-known/lnurlp/';
const wordsAsUtf8 = n => Buffer.from(bech32.fromWords(n)).toString('utf8');

/** Parse lnurl or LUD-16 lightning address

  {
    url: <Lnurl or Lightning Address String>
  }

  @throws
  <Error>

  @returns
  {
    url: <Callback Url String>
  }
*/
module.exports = ({url}) => {
  if (!url) {
    throw new Error('ExpectedLnurlOrLightningAddressToParse');
  }

  // Exit early when the URL looks like an email, indicating lightning address
  if (!!isEmail(url)) {
    const [username, domain] = parseEmail(url);

    // Check if the user name is valid
    if (!isUsername(username)) {
      throw new Error('ExpectedValidUsernameInLightningAddress');
    }

    // Because of restrictions on the HTTP request library, disallow onion URLs
    if (!!isOnion(domain)) {
      throw new Error('LnurlOnionUrlsCurrentlyUnsupported');
    }

    return {url: join([sslProtocol, domain, urlString, username])};
  }

  if (decode(asLnurl(url), bech32CharLimit).prefix !== prefix) {
    throw new Error('ExpectedLnurlPrefix');
  }

  const {words} = decode(asLnurl(url), bech32CharLimit);

  return {url: wordsAsUtf8(words)};
};
