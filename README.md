# Balance of Satoshis

Commands for working with Lightning balances.

## Install 

```shell
npm install -g balanceofsatoshis
```

Verify it's installed:

```sh
bos --version
// current installed version
``` 

## Usage

To see a list of available options and flags run: 
 
```shell
bos --help
```

### Example commands

```sh
# Outputs the full balance of the node, including pending, off-chain, on-chain
bos balance

# Output the on-chain spend resolutions of closed channels
bos closed

# Creates utxo fan-out with on-chain funds
bos fanout "amount" "count"

# Outputs a summarized version of peers forwarded towards
bos forwards

# Attempts to pay a payment request using only hidden ip or Tor node hops
bos hiddenpay "paymentrequest"

# Outputs the sum total of remote channel liquidity
bos inbound-liquidity

# Outputs the sum total of local channel liquidity
bos outbound-liquidity

# Outputs the results of testing if a payment request can be paid
bos probe [paymentrequest]

# Outputs wallet unlock result
bos unlock /path/to/password/file

## Output available utxos
bos utxos
```

## Nodes Directory

By default `bos` tries to locate `tls.cert` and `admin.macaroon` in the default `lnd` location on the local machine (`~/.lnd/` on Linux, and `~/Library/Application Support/Lnd/` on MacOS). 

To use `bos` with external nodes (or nodes with custom configuration), two things need to be done: 

1. Create directory `~/.bos/`, and add node credentials in a format of: 

    `~/.bos/YOUR_NODE_NAME/credentials.json`
    
1. Each file should have the following format:

    ```json
    {
      "cert": "base64 tls.cert value",
      "macaroon": "base64 .macaroon value",
      "socket": "host:ip"
    }
    ```
    
    > **Note:** `cert` and (admin) `macaroon` should have base64-encoded, and newline-stripped content of the files. To get the strings in appropriate format you can run, ex:
    >
    >```bash
    ># For `cert` 
    >base64 ~/.lnd/tls.cert | tr -d '\n'
    >
    ># For `macaroon`
    >base64 ~/.lnd/data/chain/bitcoin/mainnet/admin.macaroon | tr -d '\n'
    >```
    >
    > **Note_2:** `socket` should contain `host:ip` pointing to `lnd`'s gRPC interface, `localhost:10009` by convention.  
 
### Using saved nodes
 
To run commands on nodes specified this way, you need to suffix commands with their name, ex:
 
```bash
bos balance YOUR_NODE_NAME

# or

bos forwards YOUR_NODE_NAME
```

