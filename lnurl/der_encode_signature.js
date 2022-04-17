const asDer = n => (n[0]&128)?Buffer.concat([Buffer.alloc(1),n],1+n.length):n;
const bufferAsHex = buffer => buffer.toString('hex');
const {concat} = Buffer;
const decomposeSignature = sig => [sig.slice(0, 32), sig.slice(32, 64)];
const {from} = Buffer;
const header = 0x30;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const int = 0x02;

/** DER encode a signature given r and s values

  {
    signature: <Signature Buffer Object>
  }

  @returns
  {
    encoded: <DER Encoded Signature Buffer Object>
  }
*/
module.exports = ({signature}) => {
  // Split the signature for DER encoding
  const [r, s] = decomposeSignature(hexAsBuffer(signature)).map(asDer);

  const encoded = bufferAsHex(concat([
    from([header]), // Header byte indicating compound structure
    from([r.length + s.length + [int, int, r.length, s.length].length]), // Len
    from([int]), // Integer indicator
    from([r.length]), // Length of data
    r,
    from([int]), // Integer indicator
    from([s.length]), // Length of data
    s,
  ]));

  return {encoded};
};
