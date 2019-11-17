# Balance of Satoshis

Commands for working with LND balances.

[![npm version](https://badge.fury.io/js/balanceofsatoshis.svg)](https://badge.fury.io/js/balanceofsatoshis)
[![Coverage Status](https://coveralls.io/repos/github/alexbosworth/balanceofsatoshis/badge.svg?branch=master)](https://coveralls.io/github/alexbosworth/balanceofsatoshis?branch=master)
[![Build Status](https://travis-ci.org/alexbosworth/balanceofsatoshis.svg?branch=master)](https://travis-ci.org/alexbosworth/balanceofsatoshis)

## Install 

Requires an [installation of Node v10.12.0+ and NPM](https://gist.github.com/alexbosworth/8fad3d51f9e1ff67995713edf2d20126)

```shell
npm install -g balanceofsatoshis
```

Verify it's installed:

```shell
bos --version
# current installed version
``` 

## Usage

To see a list of available options and flags run: 
 
```shell
bos help

# Or get individual help with a command
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

# Get the number of days the node cert remains valid
bos cert-validity-days

# See the current fee estimates confirmation targets
bos chainfees

# Receive on-chain funds via a regular address
bos chain-deposit

# Receive funds via swap on-chain
bos chain-receive "amount"

# See details on how closed channels resolved on-chain
bos closed

# Export credentials
bos credentials

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

# Show liquidity adjustment costs
bos liquidity-cost "inbound" "amount"

# See market price history
bos market

# View and adjust list of saved nodes
bos nodes

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

# Rebalance funds between peers
bos rebalance

# Get a general report of the node activity
bos report

# Connect up to a Telegram bot
bos telegram

# Unlock the wallet if it is locked
bos unlock "path_to_password_file"

# Show unspent coin outputs
bos utxos
```

## Nodes

By default `bos` expects `tls.cert` in the root of the default `lnd` directory and
`admin.macaroon` in `<default_lnd_dir>/data/chain/bitcoin/<network>`.

Default LND directories:
* macOS: `~/Library/Application Support/Lnd/`
* Linux: `~/.lnd/`

It will check first for a mainnet macaroon, then a testnet macaroon.

### Saved Nodes

If you have another node and it is already using `balanceofsatoshis`, you can
add it as a "saved node" using `bos nodes --add`.

Otherwise you can copy the credentials into a saved nodes directory:

To use `bos` with arbitrary external nodes (or nodes with custom
configuration), two things need to be done:

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
bos inbound-liquidity --below=1000000 2>&1 | sendnotification SNS "AWS_SNS_ID" "WARNING inbound-liquidity deficit: %s sats" --nonzero --subject="Low inbound liquidity warning: node1"
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
