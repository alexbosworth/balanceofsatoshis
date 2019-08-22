# Balance of Satoshis

Commands for working with lnd balances.

## Install 

Requires Node v10.4.0+

```shell
npm install -g balanceofsatoshis
```

Verify it's installed:

```shell
bos --version
// current installed version
``` 

## Usage

To see a list of available options and flags run: 
 
```shell
bos help

// Or get individual help with a command
bos help commandName
```

### Example Commands

```shell
# See an accounting formatted list of various types of transactions
bos accounting "category"

# Set autopilot on or off. With heuristic externalscore, set guided autopilot
bos autopilot "on"

# See total balance, including pending funds, excluding future commit fees
bos balance
# 1337

# See the current fee estimates confirmation targets
bos chainfees

# Receive funds via swap on-chain
bos chain-receive "amount"

# See details on how closed channels resolved on-chain
bos closed

# Create a utxo fan-out with on-chain funds
bos fanout "amount" "count"

# Query the node to find something like a payment, channel or node
bos find "query"

# Output a summarized version of peers forwarded towards
bos forwards

# Send a gift of some tokens to a directly connected peer
bos gift "pubkey" "amount"

# See help about a command
bos help "command"

# Output the sum total of remote channel liquidity
bos inbound-liquidity

# Increase inbound liquidity to the node
bos increase-inbound-liquidity

# See market price history
bos market

# Outputs the sum total of local channel liquidity
bos outbound-liquidity

# Pay a payment request, probing first
bos pay "payment_request"

# Show channel-connected peers
bos peers

# Output the price of BTC
bos price

# Test if funds can be sent to a destination
bos probe "payment_request/public_key"

# Get a general report of the node activity
bos report

# Unlock the wallet if it is locked
bos unlock "path_to_password_file"

# Show unspent coin outputs
bos utxos
```

## Saved Nodes Directory

By default `bos` tries to locate `tls.cert` and `admin.macaroon` in the default
`lnd` location on the local machine (`~/.lnd/` on Linux, and
`~/Library/Application Support/Lnd/` on MacOS). 

It will check first for a mainnet macaroon, then a testnet macaroon.

To use `bos` with external nodes (or nodes with custom configuration), two
things need to be done: 

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
 
### Using Saved Nodes
 
To run commands on nodes specified this way, you need to suffix commands with
their name, ex:
 
```shell
bos balance --node=SAVED_NODE_NAME
bos forwards --node=SAVED_NODE_NAME
```

## Linux Fu

Some commands are designed to return outputs that can be piped or used in other CLI programs.

### Summarize Numbers

```shell
expr $(bos balance --node=savedNode1) + $(bos balance --node=savedNode1)
# outputs the combined balance of both nodes
```

### Send Alerts

```shell
bos inbound-liquidity --below=1000000 | sendnotification SNS "AWS_SNS_ID" "WARNING inbound-liquidity deficit: %s sats" --nonzero --subject="Low inbound liquidity warning: node1"
# sends email if the inbound liquidity drops below a 1,000,000 sats
```

## Docker Usage

Potentially this can be used with Docker with a simple docker file

```
FROM node:latest
RUN npm install balanceofsatoshis
ENTRYPOINT [ "/node_modules/balanceofsatoshis/bos" ]
```

```
    #! /usr/bin/env bash
    docker run -it --rm -v=$HOME/.bos:/root/.bos bos:latest ${@:1}
```
