# Balance of Satoshis

Commands for working with LND balances.

[![npm version](https://badge.fury.io/js/balanceofsatoshis.svg)](https://badge.fury.io/js/balanceofsatoshis)
[![docker pulls](https://img.shields.io/docker/pulls/alexbosworth/balanceofsatoshis?style=flat-round)](https://hub.docker.com/repository/docker/alexbosworth/balanceofsatoshis)

Supported LND versions:

- v0.17.0-beta to v0.17.3-beta
- v0.16.0-beta to v0.16.4-beta
- v0.15.2-beta to v0.15.5-beta

## Install

- Requires an [installation of Node v18+][nodejs-install-guide]

```shell
npm install -g balanceofsatoshis
```

Or use a platform-specific guide:

- [Docker/BTCPayServer install notes](#docker)
- [RaspiBlitz install guide][raspiblitz-install-guide]
- [RaspiBolt/Debian guide][raspibolt-install-guide]
- [Umbrel install guide][umbrel-install-guide]
- [Voltage install guide][voltage-install-guide]

If you want to try out any command without npm install, you can also do `npx
balanceofsatoshis` to run a command directly.

Get the version to verify that it's installed:

```shell
bos --version
# current installed version
``` 

Re-install if you want to update to a new version.

## Usage

To see a list of available options and flags run: 
 
```shell
bos help

# Or get individual help with a command
bos help commandName
```

If you want autocomplete on commands and options you can do:

```
## Autocomplete on MacOS/ZSH shells (on startup: you can add this to ~/.zshrc)
autoload -Uz compinit && compinit
source <(bos completion zsh)

## Autocomplete on bash (on startup: add to ~/.profile or ~/.bash_profile)
source <(bos completion bash)
```

## Community

Use `bos trade-secret` and buy the secret
`626f73ff0001010425002302210288be11d147e1525f7f234f304b094d6627d2c70f3313d7ba3696887b261c4447`
to gain access to the private Telegram group.

Or if you can't use bos yet you can ask about it on the
[public group](https://t.me/balanceofsatoshis)

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

# See the current fee estimates confirmation targets
bos chainfees

# Show chain fees paid
bos chart-chain-fees

# Show routing fees earned
bos chart-fees-earned

# Show routing fees paid
bos chart-fees-paid

# Show a chart of payments received
bos chart-payments-received

# Remove old failed payment data for probes and other failed payments
bos clean-failed-payments

# See details on how closed channels resolved on-chain
bos closed

# Export credentials
bos credentials

# View outbound fee rates and update outbound fee rates to peers
bos fees

# Query the node to find something like a payment, channel or node
bos find "query"

# Output a summarized version of peers forwarded towards
bos forwards

# Create a signed raw transaction for an on-chain transfer
bos fund "address" "amount"

# See help about a command
bos help "command"

# Run gateway service for https://ln-operator.github.io/ UI
bos gateway

# Look up the channels and fee rates of a node by its public key
bos graph "pubkey"

# Output the sum total of remote channel liquidity
bos inbound-liquidity

# Enforce rules on inbound channels
bos inbound-channel-rules

# Increase inbound liquidity to the node
bos increase-inbound-liquidity

# Increase the outbound liquidity of the node
bos increase-outbound-liquidity

# View and adjust list of saved nodes
bos nodes

# Open channels to public keys in a batch transaction
bos open "public_keys..."

# Open a balanced channel with a peer
bos open-balanced-channel

# Outputs the sum total of local channel liquidity
bos outbound-liquidity

# Pay a payment request (invoice), probing first
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

# Send funds using keysend and an optional message to a node
bos send

# Connect up to a Telegram bot
bos telegram

# Unlock the wallet if it is locked
bos unlock "path_to_password_file"

# Show unspent coin outputs
bos utxos
```

## Community HowTos:

- The `accounting` [command howto](https://yalls.org/articles/97d67df1-d721-417d-a6c0-11d793739be9:0965AC5E-56CD-4870-9041-E69616660E6F/bc71e6bf-f2aa-4bae-a3e8-b12e7be2284c)
- The `open` [command howto](https://satbase.org/bos-open/)
- The `rebalance` [command howto](https://yalls.org/articles/97d67df1-d721-417d-a6c0-11d793739be9:0965AC5E-56CD-4870-9041-E69616660E6F/327ed9f6-3a73-41c2-a9c7-8c4e274bdd54)
- Another `rebalance` [command howto](https://yalls.org/articles/97d67df1-d721-417d-a6c0-11d793739be9:0965AC5E-56CD-4870-9041-E69616660E6F/30a7c519-0ec0-4644-b3aa-341c41bac296)
- Running `rebalance` [video (In German)](https://www.youtube.com/watch?v=EimVHnv-SUk)
- Secrets of `rebalance` [command revealed](https://yalls.org/articles/97d67df1-d721-417d-a6c0-11d793739be9:0965AC5E-56CD-4870-9041-E69616660E6F/3c0709b7-5f6a-4a3c-944e-48b80e0556df)
- Running `telegram` [via nohup/tmux howto](https://plebnet.wiki/wiki/Umbrel_-_Installing_BoS#Installing_Telegram_Bot)
- Running `telegram` [via systemd](https://github.com/ziggie1984/miscellanous/blob/97c4905747fe23a824b6e53dc674c4a571ac0f5c/automation_telegram_bot.md)
- Another `rebalance` + `tags` & `telegram` [commands howto](https://raspibolt.org/guide/bonus/lightning/balance-of-satoshis.html#optional-connect-your-node-to-a-telegram-bot)
- Documentation for bos commands [commands howto](https://github.com/niteshbalusu11/BOS-Commands-Document#balance-of-satoshis-commands)

Want to stack some sats? Write your own LN paywalled guide!

## Nodes

By default `bos` expects `tls.cert` in the root of the default `lnd` directory
and `admin.macaroon` in `<default_lnd_dir>/data/chain/bitcoin/<network>`.

Default LND directories:
* macOS: `~/Library/Application Support/Lnd/`
* Linux: `~/.lnd/`

It will check first for a mainnet macaroon, then a testnet macaroon.

The LND directory can be overriden with an environment variable:

`BOS_DEFAULT_LND_PATH=/path/to/lnd/data/dir`

### Saved Nodes

If you have another node and it is already using `balanceofsatoshis`, you can
add it as a "saved node" using `bos nodes --add`.

Otherwise you can copy the credentials into a saved nodes directory:

To use `bos` with arbitrary external nodes (or nodes with custom
configuration), two things need to be done:

1. Create directory `~/.bos/`, and add node credentials in a format of: 

    `~/.bos/YOUR_NODE_NAME/credentials.json`

Use any shorthand you'd like when choosing this profile node name

2. Each file should have the following format:

```json
{
  "cert": "base64 tls.cert value",
  "macaroon": "base64 .macaroon value",
  "socket": "host:port"
}
```

**Note:** `cert` and (admin) `macaroon` should have base64-encoded, and newline-stripped content of the files. To get the strings in appropriate format you can run, ex:

```bash
# For `cert`
base64 -w0 ~/.lnd/tls.cert

# For `macaroon`
base64 -w0 ~/.lnd/data/chain/bitcoin/mainnet/admin.macaroon
```

**Note_2:** `socket` should contain `host:port` pointing to `lnd`'s gRPC interface, `localhost:10009` by convention.
 
You can also set `cert_path` and `macaroon_path` to the path of the relevant
files instead.

The BOS directory path can be overriden with an environment variable:

`BOS_DATA_PATH=/path/to/bos/data/dir`

#### Umbrel Saved Node

*Note: Umbrel is not FOSS software, use at your own risk.*

If you are using Umbrel and you have already installed but you get an error like
`Name resolution failed for target dns:umbrel.local:10009` then try adding
umbrel.local to your `/etc/hosts` file, like `sudo nano /etc/hosts` and add a line `127.0.0.1 umbrel.local`

1. Identify your Umbrel home dir, like /home/umbrel/umbrel
2. Look in the .env file in that dir for the `LND_IP` to use as the socket to 
    connect to

You can also use umbrel.local if that is in your Umbrel TLS cert but you will 
have to make sure the hostname is known to the client.

```
{
  "cert_path": "/home/umbrel/umbrel/app-data/lightning/data/lnd/tls.cert",
  "macaroon_path": "/home/umbrel/umbrel/app-data/lightning/data/lnd/data/chain/bitcoin/mainnet/admin.macaroon",
  "socket": "LND_IP:10009"
}
```

5. Now when you do a command, specify `--node umbrel` or whatever your dir is: `bos --node umbrel balance`

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

You can also add a JSON file to your .bos directory: config.json, add
`{"default_saved_node": "nodename"}` to set the default via a file instead

## Linux Fu

Some commands are designed to return outputs that can be piped or used in other CLI programs.

### Open many channels

Make a textfile in the terminal with newline separated pubkeys and the capacity of the channels.

```shell
cat bos_channels.txt

       │ File: bos_channels.txt
───────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
   1   │ 0337...1986 --amount=3000000
   2   │ 02a4...20de --amount=3000000
   3   │ 023c...0dec --amount=1000000

```

```shell
bos open $(cat bos_channels.txt)
```

### Summarize Numbers

```shell
expr $(bos balance --node=savedNode1) + $(bos balance --node=savedNode2)
# outputs the combined balance of both nodes
```

### Auto Adjust Fees

```
# Cron every 5 minutes adjust fees
*/5 * * * * /bin/timeout -s 2 30 /home/ubuntu/update-fees.sh
```

update-fees.sh:

```
#!/bin/bash
# Raise the outbound fees to a public key when inbound increases
/home/ubuntu/.npm-global/bin/bos fees --to PUBLIC_KEY --set-fee-rate="IF(INBOUND>10000000,1000,500)"
```

### Auto Balance Liquidity Between Two Nodes

Keep a channel balanced between two of your own nodes

```
# Cron: every 30 minutes send funds to reach 50:50
*/30 * * * * /home/ubuntu/.npm-global/bin/bos send PUBKEY --max-fee 0 --message="rebalance" --amount="IF(OUTBOUND+1*m>(LIQUIDITY/2), OUTBOUND-(LIQUIDITY/2), 0)"
```

If you want to 50:50 rebalance with a peer node, you can use 
`--out-target-inbound=capacity/2` with `bos rebalance`

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

### Persist Long-Running Commands

If you are running a long-running command and want it to persist, you will need 
something like Docker or nohup or tmux to assist you in that and then kill the 
process and restart it when updating.

Nohup example:

```shell
nohup /home/bos/.npm-global/bin/bos telegram --connect CONNECT_CODE > /dev/null &
```

Docker example:

```
docker run -d --restart always -v $HOME/.bos:/home/node/.bos alexbosworth/balanceofsatoshis telegram --connect CONNECT_CODE
```

You can also create a shell-script.sh to run a command repeatedly, with a delay

```bash
while true;
do bos rebalance;
sleep 2000;
done
```

## Docker

This presumes you have Docker installed.

- [Instructions for installing Docker on Ubuntu][docker-install-guide]

Install the Docker image:

```shell
docker pull alexbosworth/balanceofsatoshis
```

### Docker Load

You can also build the image yourself: `npm run build-docker`, this will make
`balanceofsatoshis.tar.gz` that you can rsync or scp somewhere else and then
do `docker load < balanceofsatoshis.tar.gz`.

Once the image is installed, you can "docker run" commands for all the commands:

```shell
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

```shell
--network="host" -v $HOME/Library/Application\ Support/Lnd/:/home/node/.lnd:ro
```

Or on Linux:

```shell
--network="host" -v $HOME/.lnd:/home/node/.lnd:ro
```

On BTCPayServer:

Create the credential.json file as explained in the saved nodes section, and for socket put:
`"socket": "lnd_bitcoin:10009"`

For Docker network use the Docker bridged network:

```
docker run -it --rm --network="generated_default" -v $HOME/.bos:/home/node/.bos alexbosworth/balanceofsatoshis balance --node SAVEDNODENAME
```

On Umbrel this would be:

```
# add Umbrel specific details:
## --network="host"
## --add-host=umbrel.local:192.168.1.23
## -v $HOME/umbrel/app-data/lightning/data/lnd:/home/node/.lnd:ro
docker run -it --rm --network=umbrel_main_network --add-host=localhost:10.21.21.9 -v $HOME/.bos:/home/node/.bos -v $HOME/umbrel/app-data/lightning/data/lnd:/home/node/.lnd:ro alexbosworth/balanceofsatoshis report
```

Note: For [umbrel-os](https://github.com/getumbrel/umbrel-os) users, when
running the above docker run command, ensure the "192.168.1.23" portion of the 
command is updated to reflect the IP of the lnd container. You can find the IP 
by looking for the `LND_IP` value inside the `$HOME/umbrel/.env` file.

Otherwise you can just pass the local node credentials as shown above using the
saved nodes.

If you are running a long-running command like `telegram`, use  `-d --restart 
always` instead of `-it --rm` to run in daemon mode and auto-restart.

Note: if you are used to using ctrl+c to terminate the process, that doesn't
work on Docker. Instead, you can use ctrl+p and then ctrl+q to background the 
interactive mode, then do `docker ps` and `docker rm` to kill the instance.

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

You can also define an alias for placing in `~/.profile` or `~/.bash_profile`:

```shell
alias bos="docker run -it --rm -v $HOME/.bos:/home/node/.bos alexbosworth/balanceofsatoshis"
```

Adjust this alias to however you run the full Docker command. Remember to
execute the ~/.profile to install the alias into your current session: `. 
~/.profile`

You can also create an alias to run a command in the background

```shell
alias bosd="docker run -d --rm -v $HOME/.bos:/home/node/.bos alexbosworth/balanceofsatoshis"
```

## Formulas

Some commands take formula arguments. Formulas are expressions that allow you 
to perform functions and reference variables.

There is a dynamic playground here where you can play with expressions:
https://formulajs.info/functions/

### `--avoid`

In `--avoid` flag commands like rebalance, a formula can be applied
directionally:

`--avoid "fee_rate < 100/<PUBKEY>"` to avoid channels forwarding to the public
key that charge a fee rate under 100 PPM.

Available variables:

- `age`: Age of the channel vs the current height
- `base_fee`: Base fee to be charged to route
- `capacity`: Capacity of the channel
- `fee_rate`: PPM fee to be charged to route
- `height`: Absolute height of the channel
- `opposite_fee_rate`: PPM fee that is charged in the non-routing direction

### `amount`

Formula amounts are supported in the following commands:

- `fund`
- `inbound-channel-rules`
- `open`
- `probe`
- `rebalance`
- `send`

When passing an amount you can pass a formula expression, and the following variables are
defined:

- `k`: 1,000
- `m`: 1,000,000

Examples:

```shell
bos fund <address> "7*m"
// Fund address with value 7,000,000

bos probe <key> "100*k"
// Probe to key amount 100,000

bos send <key> "m/2"
// Push 500,000 to key
```

#### `rebalance`

Rebalance defines additional variables for `--amount`:

-  `capacity`: The total of inbound and outbound

And for `--in-filter` and `--out-filter`:

- `capacity`: The total capacity with the peer
- `heights`: The set of heights of the channels with the peer
- `inbound_fee_rate`: The fee rate the peer is charging
- `inbound_liquidity`: The inbound liquidity with the peer
- `outbound_liquidity`: The outbound liquidity with the peer
- `pending_payments`: The number of pending payments

Example:

```shell
// Rebalance with a target of 1,000,000
bos rebalance --amount "1*m"
```

#### `send`

Send defines additional variables:

- `eur`: The value of 1 Euro as defined by rate provider
- `inbound`: The inbound liquidity with the destination
- `liquidity`: The total capacity with the destination
- `outbound`: The inbound liquidity with the destination
- `usd`: The value of 1 US Dollar as defined by rate provider

Example:

```shell
// Send node $1
bos send <key> --amount "1*usd"
```

#### `transfer`

Transfer variables:

- `out_inbound`: The outbound liquidity with the outbound peer
- `out_liquidity`: The total inbound+outbound with the outbound peer
- `out_outbound`: The total outbound liquidity with the outbound peer

Example:

```shell
// Equalize inbound with a mutual peer
bos transfer node "in_inbound - (in_inbound + out_inbound)/2" --through peer
```

### `fees`

Variables can be referenced for `--set-fee-rate`

- `fee_rate_of_<pubkey>`: Reference other node's fee rate
- `inbound`: Remote balance with peer
- `inbound_fee_rate`: Incoming fee rate
- `outbound`: Local balance with peer

You can also use functions:

- `bips(n)`: Set fee as parts per thousand
- `percent(0.00)`: Set fee as fractional percentage

Example:

```shell
// Set the fee rate to a tag to 1% of the value forwarded
bos fees --to tag --set-fee-rate "percent(1)"
```

### `inbound-channel-rules`

Pass formulas for rules with `--rule`.

Formula variables:

- `capacities`: sizes of the peer's public channels
- `capacity`: size of the inbound channel
- `channel_ages`: block ages of the peer's public channels
- `fee_rates`: outbound fee rates for the peer
- `local_balance`: gifted amount on the incoming channel
- `private`: request is to open an unannounced channel
- `public_key`: key of the incoming peer

Example:

```shell
// Reject channels that are smaller than 2,000,000 capacity
bos inbound-channel-rules --rule "capacity < 2*m"

// Set separate capacity limits depending on private status
bos inbound-channel rules --rule "if(private,capacity >= 9*m,capacity >= 5*m)"
```

[docker-install-guide]: https://www.digitalocean.com/community/tutorials/how-to-install-and-use-docker-on-ubuntu-18-04
[nodejs-install-guide]: https://gist.github.com/alexbosworth/8fad3d51f9e1ff67995713edf2d20126
[raspiblitz-install-guide]: https://gist.github.com/openoms/823f99d1ab6e1d53285e489f7ba38602
[raspibolt-install-guide]: https://raspibolt.org/guide/bonus/lightning/balance-of-satoshis.html
[umbrel-install-guide]: https://plebnet.wiki/wiki/Umbrel_-_Installing_BoS
[voltage-install-guide]: https://docs.voltage.cloud/balance-of-satoshis-guides/balance-of-satoshis
