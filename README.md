# Balance of Satoshis

Commands for working with Lightning balances.

```
bos balance

// Outputs the full balance of the node, including pending, off-chain, on-chain

bos inbound-liquidity

// Outputs the sum total of remote channel liquidity
```

## Nodes Directory

To add nodes, create a directory at ~/.bos to hold node credentials

Create individual node credentials by creating folders with their alias, then
edit a `credentials.json` file inside of the folder, like
`~/.bos/mynode/credentials.json`. The contents of this file should contain the
`base64 filename` output for the `tls.cert`, `.macaroon` file, and the ip and
port of the node GRPC.

Example:

```
~/.bos/mynode/credentials.json
```

```json
{
  "cert": "base64 tls.cert value",
  "macaroon": "base64 .macaroon value",
  "socket": "host:ip"
}
```

