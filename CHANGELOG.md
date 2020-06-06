# Versions

## Version 5.38.5

- Fixed issue where invoice results parsing caused intermittent errors

## Version 5.38.2

- `rebalance`: Fix issue with checking when `--in` key is not present
- `telegram`: Eliminate redundant on-chain tx messages

## Version 5.38.1

- `increase-inbound-liquidity`: Improve support for large swaps on LND 0.10.0
- `increase-inbound-liquidity`: Add support to `--avoid` for channels, aliases

## Version 5.38.0

- `chart-payments-received`: Add method to chart received amounts vs time

## Version 5.37.5

- `rebalance`: Avoid auto-selecting an out peer equal to the in peer

## Version 5.37.4

- `telegram`: Improve reliability of long-running operation

## Version 5.37.0

- `telegram`: Remove reporting of payments due to excessive mem usage
- `telegram`: Add reporting of on-chain transactions

## Version 5.36.0

- `forwards`: Change output to table, view old output with `--complete`
- `forwards`: Omit public keys from table when window size is not very wide
- `increase-inbound-liquidity`: Add `--service-socket` to specify swap socket
- `increase-inbound-liquidity`: Try and use multiple paths if possible
- `peers`: Change output to table, view old output with `--complete`
- `peers`: Omit public keys from table when window size is not very wide
- `probe`: Change `--find-max` to try to find maximum across multiple routes

## Version 5.35.4

- `remove-peer`: Fix selection of peer using public key

## Version 5.35.2

- `forwards`: Fix support for `--no-color` when using `--table`
- `forwards`: Fix `--table` on systems that have issues with empty cells
- `peers`: Fix support for `--no-color` when using `--table`
- `peers`: Fix `--table` on systems that have issues with empty cells

## Version 5.35.1

- `pay`: Allow specifying `--in` or `--out` direct peer aliases instead of keys
- `probe`: Allow `--in` or `--out` direct peer aliases instead of public keys
- `remove-peer`: Allow specifying an alias of a peer to remove instead of a key
- `send`: Add public key, timestamp, signature when `--message` is specified

## Version 5.35.0

- `chain-receive`: Use native segwit address instead of nested
- `forwards`: Add `--table` option to show forwarding peers in a table
- `increase-inbound-liquidity`: Remove `--no-auth` option

## Version 5.34.1

- `remove-peer`: Improve support for force closing out on a disconnected peer

## Version 5.34.0

- `telegram`: Post an update when a payment is sent (only on LND 0.10.0)

## Version 5.33.0

- `chain-receive`: Require auth payment to initiate swap
- `open`: Add method to open one or more channels funded by an external wallet

## Version 5.32.0

- `price`: Add `--from` to specify rate provider

## Version 5.31.0

- `peers`: Add `--table` option to show peers in a tabular format
- `rebalance`: Improve reporting of peer liquidity with respect to pending htlcs

## Version 5.30.1

- `rebalance`: Fix final rebalance report output for concurrent rebalances
- `rebalance`: Add `--in-target-outbound` to set outbound amount for --in peer
- `rebalance`: Add `--out-target-inbound` to set inbound amount for --out peer

## Version 5.29.1

- `balance`: Remove over-reporting of chain balance from closing channels

## Version 5.29.0

- `rebalance`: Allow specifying an alias to avoid, provided the alias is a peer

## Version 5.28.4

- `peers`: Avoid including liquidity from pending close channels

## Version 5.28.3

- `increase-outbound-liquidity`: Improve opening channels with connected peers

## Version 5.28.2

- Fix automatic detection of credentials on Windows

## Version 5.28.0

- `chart-fees-earned`: Sum across nodes with multiple `--node` arguments
- `chart-fees-paid`: Sum across nodes with multiple `--node` arguments

## Version 5.27.0

- `chart-fees-paid`: Add `--peers` and `--network` to filter out peers/non-peers

## Version 5.26.4

- `forwards`: Improve sorting of peers

## Version 5.26.3

- `increase-outbound-liquidity`: Add `--private` to increase private outbound

## Version 5.25.0

- `rebalance`: Add `--minutes` to specify timeout in minutes for a route search

## Version 5.24.2

- `increase-inbound-liquidity`: Improve parsing of spend amount

## Version 5.24.1

- `increase-inbound-liquidity`: Fix execution without settings

## Version 5.24.0

- `rebalance`: Add `out-channel` to whitelist specific channels set

## Version 5.23.0

- `increase-inbound-liquidity`: Add send exact amount option

## Version 5.22.3

- `rebalance`: Improve automatic inbound peer selection

## Version 5.22.0

Improve support for node version 10

- `chart-fees-paid`: Show routing fees paid and payment breakdowns by node

## Version 5.21.2

- `remove-peer`: Fix specifying peer public key
- `report`: Highlight circular rebalances

## Version 5.21.0

- `chain-receive`: add `--in` argument to specify desired inbound peer

## Version 5.20.0

- `remove-peer`: add method to remove channels with a peer

## Version 5.19.1

Improve compatibility with older node versions

## Version 5.19.0

- `peers`: add `--idle-days` to show only peers that have been idle for n days
- `peers`: add `--last-received` to show the last final hop payments from peer
- `peers`: add `--omit` to omit peers from the list
- `send`: add method to unilaterally send to a destination accepting such sends
- `telegram`: show messages received with received payments

## Version 5.18.0

- `pay`: Add `--message` to send a message along with the payment

## Version 5.17.0

- Add config.json support to specify default saved node

## Version 5.16.2

- Fix issue with saxophone out of date warning

## Version 5.16.0

- `swap-api-key`: Add method to purchase or view details about a swap api token

## Version 5.15.0

- `inbound-liquidity`: Add `--max-fee-rate` to specify the max inbound fee rate
- `inbound-liquidity`: Add `--min-score` to specify the minimum node score

## Version 5.14.0

- `rebalance`: Add `--amount` to specify maximum rebalance amount

## Version 5.13.1

- `chain-receive`: Add `api-key` and `no-auth` options for swap authentication
- `increase-inbound-liquidity`: Add `--api-key` and `--no-auth` options
- `rebalance`: Add the option to `--avoid` a channel

## Version 5.12.0

Add the ability to use a default saved node by specifying a
`BOS_DEFAULT_SAVED_NODE` environment variable.

Add the ability specify `cert_path` and `macaroon_path` in saved node
credentials file to avoid copying and pasting values.

## Version 5.11.1

Change routing logic on LND 0.9.0 nodes to add support for 0.9.0 pathfinding
changes.

## Version 5.11.0

- `decrypt`: Add method to decrypt a message using the node key
- `encrypt`: Add method to decrypt a message using the node key

## Version 5.10.1

- `liquidity-cost`: Add parameter to get fast swap out price

## Version 5.9.8

- `price`: Change fiat oracle to coindesk

## Version 5.9.7

- `fund-dev`: Remove function
- `report`: Change fiat oracle to coindesk

## Version 5.9.6

- `market`: Fix issue with market data not being returned

## Version 5.9.5

- `accounting`: Fix issue with unexpected commas in rows
- `increase-inbound-liquidity`: Add compatibility with service fee API change

## Version 5.9.0

- `rebalance`: Allow specifying alias for inbound and outbound peer
- `rebalance`: Add option `--is_avoiding_high_inbound` to avoid over-rebalancing

## Version 5.8.2

- `credentials`: Add `--days` option to time-limit the credentials validity

## Version 5.8.0

- `reconnect`: Add command to attempt reconnecting to offline peers

## Version 5.7.3

- `chart-fees-earned`: add `--count` to show number of forwards instead of fees

## Version 5.7.1

- `telegram`: send messages on channel open or close, rebalance

## Version 5.6.2

- `credentials`: add `--cleartext` option to output node access credentials

## Version 5.6.1

- `increase-outbound-liquidity`: add `fee-rate` option to specify chain fee rate

## Version 5.6.0

- `balance`: Add `--confirmed` option to show only confirmed funds
- Add `increase-outbound-liquidity` command to create a new channel
- `pay`: Allow paying invoices more than the regular network limit
- `peers`: Properly display zero inbound fees

## Version 5.5.1

- `peers`: Add `fee-days` option to show fees earned via a peer
- `peers`: Add `first_connected` attribute to peers list
- `peers`: Add `private` option to only show private channel peers

## Version 5.4.0

- `chart-fees-earned`: Add `via` argument to show only fees related to a peer
- Add `fund-dev`: method to fund Bitcoin and Lightning development efforts

## Version 5.3.1

- Add `chart-fees-earned` to show a chart of fees earned

## Version 5.2.2

- `increase-inbound-liquidity`: Add `--fast` option to choose a fast swap

## Version 5.1.1

- `cert-validity-days`: Add method to indicate the days left until cert expires

## Version 5.0.7

- `credentials`: Add method to export node credentials
- `nodes`: Add `-add` and `--remove` options to add and remove saved nodes

### Breaking Changes

- Node 10.12.0 or higher is required

## Version 4.8.0

- `telegram`: Add pay method to pay a payment request

## Version 4.7.0

- `telegram`: Add method to connect to a Telegram bot

## Version 4.6.0

- `chain-deposit`: Add method to show an on-chain address

## Version 4.5.2

- `nodes`: Add `--lock` and `--unlock` methods to encrypt and decrypt saved node
    credentials

## Version 4.4.0

- `nodes`: Add method to list out all saved nodes

## Version 4.3.0

- `increase-inbound-liquidity`: Add `avoid` argument to avoid forwards through 
    nodes.

## Version 4.2.1

- `peers`: Add inbound fee rate attribute to peers listing

## Version 4.2.0

- `accounting`: Add `month` and `year` flags to return only specified date range results

## Version 4.1.0

- `pay`, `probe`, `rebalance`: Add repeatable `avoid` flag to avoid forwarding via avoid nodes

## Version 4.0.0

### Breaking Changes

- Support for LND version `v0.7.0` and below is ended

## Version 3.7.0

- `liquidity-cost`: command added to check the cost of swap liquidity
- `peers`: added `--offline` restriction flag

## Version 3.6.0

- Add update notifier to notify of new versions

## Version 3.5.2

- `rebalance`: added to off-chain rebalance liquidity between peers

## Version 3.4.1

- `peers`: add --sort to sort returned peers by an attribute

## Version 3.3.0

- `probe`: add --find-max to try and find the max sendable

## Version 3.2.0

- `chainfees` fix issue where a bad response from the rate provider would not be detected
- `pay`: added --in and --out to specify in and out routing peers for payments
- `probe`: added --in and --out to specify in and out routing peers for probe
- `probe`: changed arguments to allow probing a public key and amount in addition to a payreq

## Version 3.1.0

- `market`: added to show market price history

## Version 3.0.0

- `chain-receive`: added to create address to receive on-chain funds via submarine swap
- `closed`: added compatibility with btctestnet
- `inbound-liquidity`: added argument --with to limit liquidity measure to a single peer
- `increase-inbound-liquidity`: Added arg --max-fee to limit the estimated fee paid  
- `pay`: added to pay a payment request
- `peers`: added to show connected peers with liquidity information

### Breaking Changes

Arguments have been standardized on `kebab-case`, `snake_case` is no longer used.

- `accounting`: --rate-provider replaces --rate_provider
-  `utxos`: --count-below replaces --count_below
