# Versions

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
