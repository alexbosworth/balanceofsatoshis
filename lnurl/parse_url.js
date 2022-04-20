const {bech32} = require('bech32');

const {decode} = bech32;
const asLnurl = n => n.substring(n.startsWith('lightning:') ? 10 : 0);
const bech32CharLimit = 2000;
const emailPattern = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;
const isOnion = n => /onion/.test(n);
const prefix = 'lnurl';
const sslProtocol = 'https://';
const testEmail = n => emailPattern.test(n);
const testUsername = n => /^[a-z0-9_.]*$/.test(n);
const urlString = '/.well-known/lnurlp/';
const wordsAsUtf8 = n => Buffer.from(bech32.fromWords(n)).toString('utf8');

/** Parse lnurl or lightning address

  {
    url: <Lnurl or Lightning Address String>
  }

  @returns
  {
    url: <Callback Url>
  }
*/
module.exports = ({url}) => {
  if (!url) {
    throw new Error('ExpectedLnurlOrLightningAddressToParse');
  }

  // Check if its a valid email address
  if (!!testEmail(url)) {
    const [username, domain] = url.split('@');

    // Check if the user name is valid
    if (!testUsername(username)) {
      throw new Error('ExpectedValidUsernameInLightningAddress');
    }

    if (!!isOnion(domain)) {
      throw new Error('ExpectedValidClearnetLightningAddress');
    }

    const callbackUrl = [
      sslProtocol,
      domain,
      urlString,
      username,
    ];

    return callbackUrl.join('');
  }

  // Check for lnurl is valid
  try {
    decode(asLnurl(url), bech32CharLimit);
  } catch (err) {
    throw new Error(400, 'FailedToDecodeLnurl', {err});
  }
  

  if (decode(asLnurl(url), bech32CharLimit).prefix !== prefix) {
    throw new Error(400, 'ExpectedLnUrlPrefix');
  }

  const {words} = decode(asLnurl(url), bech32CharLimit);

  return wordsAsUtf8(words);
}
