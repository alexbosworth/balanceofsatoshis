# Balance of Satoshis

Commands for working with LND balances.

[![npm version](https://badge.fury.io/js/balanceofsatoshis.svg)](https://badge.fury.io/js/balanceofsatoshis)
[![Coverage Status](https://coveralls.io/repos/github/alexbosworth/balanceofsatoshis/badge.svg?branch=master)](https://coveralls.io/github/alexbosworth/balanceofsatoshis?branch=master)
[![Build Status](https://travis-ci.org/alexbosworth/balanceofsatoshis.svg?branch=master)](https://travis-ci.org/alexbosworth/balanceofsatoshis)

## Install

- Requires an [installation of Node v10.12.0+](https://gist.github.com/alexbosworth/8fad3d51f9e1ff67995713edf2d20126)
- Have a RaspiBlitz? Check out [this install guide](https://gist.github.com/openoms/823f99d1ab6e1d53285e489f7ba38602)

If you want to try out any command without npm install, you can also do `npx
balanceofsatoshis` to run a command directly.

If you have [Docker](https://docs.docker.com/get-docker/) installed, you can
[run through Docker](#Docker) instead.

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

Or ask about commands on [Telegram](https://t.me/balanceofsatoshis)

### Example Commands

```shell
# See an accounting formatted list of various types of transactions
bos accounting "category"

# See total balance, including pending funds, excluding future commit fees
bos balance

# Get the number of days the node cert remains valid
bos cert-validity-days

# Receive on-chain funds via a regular address
bos chain-deposit

# Receive funds via swap on-chain
bos chain-receive "amount"

# See the current fee estimates confirmation targets
bos chainfees

# Show routing fees earned
bos chart-fees-earned

# Show routing fees paid
bos chart-fees-paid

# Show a chart of payments received
bos chart-payments-received

# See details on how closed channels resolved on-chain
bos closed

# Export credentials
bos credentials

# Create a utxo fan-out with on-chain funds
bos fanout "amount" "count"

# View outbound fee rates and update outbound fee rates to peers
bos fees

# Query the node to find something like a payment, channel or node
bos find "query"

# Output a summarized version of peers forwarded towards
bos forwards

# See help about a command
bos help "command"

# Output the sum total of remote channel liquidity
bos inbound-liquidity

# Increase inbound liquidity to the node
bos increase-inbound-liquidity

# Increase the outbound liquidity of the node
bos increase-outbound-liquidity

# View and adjust list of saved nodes
bos nodes

# Open channels to public keys using external funding
bos open "public_keys..."

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

# Remove all channels with a peer
bos remove-peer

# Get a general report of the node activity
bos report

# Send funds and an optional message to a node
bos send

# Connect up to a Telegram bot
bos telegram

# Unlock the wallet if it is locked
bos unlock "path_to_password_file"

# Show unspent coin outputs
bos utxos
```

## HowTos:

- The `accounting` [command howto](https://yalls.org/articles/97d67df1-d721-417d-a6c0-11d793739be9:0965AC5E-56CD-4870-9041-E69616660E6F/bc71e6bf-f2aa-4bae-a3e8-b12e7be2284c)

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
 
 You can also set `cert_path` and `macaroon_path` to the path of the relevant
 files instead.

### Using Saved Nodes
 
To run commands on nodes specified this way, you need to suffix commands with
their name, ex:
 
```shell
bos balance --node=SAVED_NODE_NAME
bos forwards --node=SAVED_NODE_NAME
```

If a saved node is actually your default node, you can set an environment
variable to avoid adding the --node prefix

`export BOS_DEFAULT_SAVED_NODE=nodename`

If that is set, it will use that node if no node is specified.

You can also add a JSON fille to your .bos directory: config.json, add
"default_saved_node": "nodename" to set the default via a file instead

## Linux Fu

Some commands are designed to return outputs that can be piped or used in other CLI programs.

### Summarize Numbers

```shell
expr $(bos balance --node=savedNode1) + $(bos balance --node=savedNode2)
# outputs the combined balance of both nodes
```

## Alerts and Reports with `sendnotification`

Some commands are made with the idea that they can trigger an alert or regular
report by piping the output of a command into some reporting script like
[sendnotification](https://www.npmjs.com/package/sendnotification) which works
with AWS SNS service to deliver notifications

Examples of shell scripts that could be executed by crontab:

### Cert Expiration Alert

```shell
# cert-expiration-alert.sh

#!/bin/bash
/path/to/bos cert-validity-days --below 30 | \
/path/to/sendnotification SNS "sns-topic-id" "Warning: %s days left on TLS cert" \
--nonzero --subject="Cert expiration warning"

# sends email when the certification has less than 30 days left until invalid
```

### Daily Node Report

```shell
# daily-report.sh

#!/bin/bash
/path/to/bos report --styled 2>&1 | \
/path/to/sendnotification SNS "sns-topic-id" "%s" --subject="Daily node update"

# sends email about what has happened on the node in the past day
```

### Low Channel Balance Alert

```shell
# low-offchain-outbound-liquidity alert

#!/bin/bash
/path/to/bos balance --offchain --below 4000000 | \
/path/to/sendnotification SNS "sns-topic-id" "off-chain balance deficit: %s sats" \
--nonzero --subject="Low balance warning"

# sends email if the channel balance goes below a threshold
```

### Low Inbound Liquidity Alert

```shell
# low-inbound-liquidity.sh

#!/bin/bash
/path/to/bos inbound-liquidity --below=1000000 2>&1 | \
/path/to/sendnotification SNS "sns-topic-id" \
"WARNING inbound-liquidity deficit: %s sats" --nonzero \
--subject="Low inbound liquidity warning: node1"

# sends email if the inbound liquidity drops below a 1,000,000 sats
```

## Docker

This presumes you have Docker installed.

- [Instructions for installing Docker on Ubuntu](https://www.digitalocean.com/community/tutorials/how-to-install-and-use-docker-on-ubuntu-18-04)

### Docker Load

Install the Docker image:

```
docker pull alexbosworth/balanceofsatoshis
```

You can also build the image yourself: `npm run build-docker`, this will make
`balanceofsatoshis.tar.gz` that you can rsync or scp somewhere else and then
do `docker load < balanceofsatoshis.tar.gz`.

Once the image is installed, you can "docker run" commands for all the commands:

```
# Make sure you have a home directory created to give Docker access to
mkdir $HOME/.bos

docker run -it --rm -v $HOME/.bos:/home/node/.bos alexbosworth/balanceofsatoshis --version
# Should output the version
```

This maps your home directory to the docker home directory to enable
persistence of credentials.

If you want it to automatically detect your local node, also pass the LND home
dir as an additional -v argument to docker run:

If you are on MacOS:

```
--network="host" -v $HOME/Library/Application\ Support/Lnd/:/home/node/.lnd:ro
```

Or on Linux:

```
--network="host" -v $HOME/.lnd:/home/node/.lnd:ro
```

Otherwise you can just pass the local node credentials as shown above using the
saved nodes.

### Build Your Own

If you don't want to use the Dockerfile, you can build a docker file for
yourself

```dockerfile
FROM node:latest
RUN npm install balanceofsatoshis
ENTRYPOINT [ "/node_modules/balanceofsatoshis/bos" ]
```

### Run Shell Script

If you don't want to type out "docker run", and don't have an alias for it, you
can create a simple shell script to fill that part in:

```shell
#! /usr/bin/env bash
docker run -it --rm -v=$HOME/.bos:/root/.bos bos:latest ${@:1}
```
