const certDetails = require('./cert_details');

const getDay = n => n.slice(4, 6);
const getHour = n => n.slice(6, 8);
const getMinute = n => n.slice(8, 10);
const getMonth = n => n.slice(2, 4) - 1;
const getSecond = n => n.slice(10, 12);
const getYear = n => `20${n.slice(0, 2)}`;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isArray} = Array;

/** Derive expiration information from a certificate

  {
    cert: <Hex Encoded Certificate String>
  }

  @throws
  <Error>

  @returns
  {
    expires_at: <Certificate Expires at ISO 8601 Date String>
  }
*/
module.exports = ({cert}) => {
  if (!cert) {
    throw new Error('ExpectedCertificateToDeriveCertExpirationDate');
  }

  // Parse out the details
  const details = certDetails({data: hexAsBuffer(cert)});

  if (!details.children.length) {
    throw new Error('ExpectedCertificateMetadataToGetCertExpiration');
  }

  // Look for cert metadata
  const [metadata] = details.children;

  if (!metadata || !isArray(metadata.children)) {
    throw new Error('ExpectedMetadataIncludingCertExpirationDate');
  }

  // Find the issue and expire dates
  const [,,,, dates] = metadata.children;

  if (!dates || !isArray(dates.children)) {
    throw new Error('ExpectedMetadataDatesToDeriveCertExpiration');
  }

  // Pull out the expire date value
  const [, {value}] = dates.children;

  const day = getDay(value);
  const hour = getHour(value);
  const minute = getMinute(value);
  const month = getMonth(value);
  const second = getSecond(value);
  const year = getYear(value);

  const date = new Date(Date.UTC(year, month, day, hour, minute, second));

  return {expires_at: date.toISOString()};
};
