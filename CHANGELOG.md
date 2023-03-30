# Versions

## 13.31.4

- `open-balanced-channel`: Make refund transaction use a chain target fee

## 13.31.2

- `call`: Add support for `signChainAddressMessage` for a chain addr signature
- `call`: Add support for `verifyChainAddressMessage` to verify a address sig

## 13.30.0

- `call`: Add support for `getBlock` to get a block from the Blockchain

## 13.29.0

- `call`: Add support for `getChainAddresses` to see created chain addresses

## 13.28.0

- `call`: Add support for `subscribeToPayments` to see outgoing payment actions

## 13.27.0

- `inbound-channel-rules`: Add support for CLEARNET and TOR in rule formulas

## 13.26.0

- `fund`: Add `broadcast` flag to allow for broadcasting the signed transaction

## 13.25.2

- `probe`: Add option `--avoid-high-fee-routes` to ignore too high paths
- `probe`: Add option `--max-fee` to specify a maximum fee to look for

## 13.24.1

- `send`: Add option `--avoid-high-fee-routes` to ignore out of range fee paths

## 13.23.0

- `pay`: Add option `--avoid-high-fee-routes` to ignore out of range fee paths
- `pay`: Add support for specifying 0 for `--max-fee` in payments

## 13.22.0

- `limit-forwarding`: Add `--deny` to specify directional forwarding denials

## 13.21.0

- `inbound-channel-rules`: Add support for multiple `--coop-close-address`

## 13.20.0

- `create-channel-group`: Add logging to indicate that members are present

## 13.19.0

- `call`: Add `acceptsChannelOpen`, `connectPeer`, `findKey`, `getNetwork`
    methods to check for open acceptance, connect to a peer without specifying
    a socket, find a public key identity for a peer alias, get the network name

## 13.18.0

- `open-balanced-channel`: Add support for Taproot to `--coop-close-address`

## 13.17.2

- `inbound-channel-rules`: Add support for Taproot `--coop-close-address`

## 13.16.0

- `balance`: Add support for Taproot UTXOs

## 13.15.0

- `telegram`: Indicate outgoing peer alias on sent payment notifications

## 13.14.2

- `remove-peer`: Indicate if the peer is paying the closing transaction fee

## 13.13.0

- `invoice`: Add `--hours` to control the expiration date of a created invoice
- `telegram`: Add `--ignore-rebalances-below` to ignore low value rebalances

## 13.12.0

- `swap`: Add support for P2TR addresses

## 13.11.0

- `balance`: Add support for multiple nodes when using --detailed balance
- `telegram`: Add support for showing balance information with /balance command

## 13.10.7

- `invoice`: Fix issue creating `--virtual` invoices

## 13.10.4

- `probe`: Fix probing to nodes that advertise trusted funding support

## 13.10.2

- `invoice`: Fix termination on HTLC subscription error

## 13.10.1

- `telegram`: On received payments, reveal the peers that forwarded the funds

## 13.9.0

- `create-channel-group`: Add `--allow` to order and allow only specific nodes

## 13.8.0

- `invoice`: Add `--virtual` and `--virtual-fee-rate` to use virtual channel

## 13.7.2

- `invoice`: Fix payment encoding to include invoice feature bits

## 13.7.1

- `invoice`: Fix `--select-hints` with an empty description request encoding

## 13.7.0

- `invoice`: Add command to create a new invoice

## 13.6.0

- `tags`: Support tag icons in routing failure source descriptions

## 13.5.1

- `accounting`: Optimize invoices report to use less memory

## 13.5.0

- `accounting`: Add `--date` to allow for precision of accounting within month

## 13.4.0

- `rebalance`: Add `--avoid-high-fee-routes` to ignore routes over max fee rate

## 13.3.7

- `fund`: Fix failure using the MAX amount to fund an address to the max

## 13.3.6

- Add support for LND 0.15.4

## 13.3.3

- `telegram`: Improve compatibility with future LND versions

## 13.3.1

- `trade-secret`: Fix issue where connecting to seller failed

## 13.3.0

- `telegram`: Support multiple word queries in /graph and /liquidity

## 13.2.0

- `telegram`: Support formulas in /invoice command, including *USD and *EUR

## 13.1.7

- `open-group-channel`: Fix support for LND 0.15.3 when using P2TR inputs

## 13.1.6

- `telegram`: Fix crash when unrecognized/unknown button press is received

## 13.1.4

- `increase-outbound-liquidity`, `open`: Apply `--set-fee-rate` on open when
    supported

## 13.1.0

- `create-group-channel`: Add method to non-interactively create channel group
- `join-group-channel`: Add method to non-interactively join channel group

## 13.0.3

- `accounting`: Improve reliability

## 13.0.2

- `telegram`: Fix termination when the invoices subscription fails

## 13.0.1

- `report`: Fix error when running command

### Breaking Changes

- Node.js 12 is no longer supported, Node.js 14 or higher is required

## 12.35.2

- `telegram`: Gracefully recover when cannot delete invoking /invoice command

## 12.35.1

- `telegram`: Omit fail responses in telegram when not using CLI connect code

## 12.35.0

- `peers`: Add `BLOCKS_SINCE_LAST_CHANNEL` variable to `--filter`

## 12.34.0

- `chart-fees-earned`, `chart-chain-fees`, `chart-fees-paid`,
    `chart-payments-received`: `--end`, `--start`: support leaving out MM or DD

## 12.33.0

- `forwards`: Add support for `tag` filters to show forwards from alias'd peers

## 12.32.0

- `inbound-channel-rules`: Add support for `PRIVATE` variable in rule formulas

## 12.31.0

- Eliminate partial matching support from tag lookups by alias

- `find`, `peers`: Adjust estimated disk footprint to assume 0.15.0 update size
- `remove-peer`: Log the closing fee and closing fee rate for closing channels

## 12.30.0

- `swap`: Add support for Lightning Loop MuSig2 experimental swaps
- `swap`: Provide method to restart a swap request using a recovery code

## 12.29.0

- `open`: Add support for `--avoid-broadcast` to allow control over publishing
- `open`: Add support for `private-trusted` and `public-trusted` channel types

## 12.28.2

- `remove-peer`: Set high tolerance for peer max fee when coop closing channel

## 12.28.1

- `chart-payments-received`: Optimize reporting speed for short times
- `chart-payments-received`: Add `--count` to report on count of payments
- `chart-payments-received`: Add `--for` to filter for a matching description

## 12.27.0

- `rebalance`: `--in-filter`, `--out-filter`: add `INBOUND_FEE_RATE` variable
- `rebalance`: Ignore inbound-disabled peers when specifying `--in-filter`

## 12.26.5

- `telegram`: Optimize /command speed by reducing duplicate wallet info calls

## 12.26.4

- `telegram`: Fix button push handling and responding to button push queries

## 12.26.3

- `open-group-channel`: Fix sufficient balance check coordinating pair group

## 12.26.2

- `telegram`: Improve reliability of /commands if lnd connection is interrupted

## 12.26.1

- `open-group-channel`: Fix sufficient balance check for 2 party channel groups

## 12.26.0

- `call`: Add support for `sendToChainAddress` to send coins on chain

## 12.25.0

- `chart-fees-earned`, `chart-chain-fees`, `chart-payments-received`: Support
    `--end` and `--start` on the same day for a single day date range
- `chart-fees-paid`: Add `--end` and `--start` options for fees over a range

## 12.24.0

- `call`: Add `subscribeToPastPayment` to subscribe to progress on a payment

## 12.23.0

- Route descriptions now reference directional edges rather than only channels
- `--avoid` flags can now include a reference to a directional edge
- `--avoid` using edge references will not exit with fail on channel not found

## 12.22.0

- `reconnect`: Restore active disconnection for inactive channel peers

## 12.21.0

- `chart-fees-earned`:  Add `--end` and `--start` options to specify date range

## 12.20.1

- `chart-chain-fees`: validate --start date
- `chart-payments-received`: validate --start date

## 12.20.0

- `chart-chain-fees`: Add `--end` and `--start` options to specify a date range

## 12.19.0

- `chart-payments-received`: Add `--end` and `--start` options to specify range

## 12.18.1

- `trade-secret`: Fix connecting to seller when not already connected

## 12.18.0

- `remove-peer`: Add support for multiple close addresses

## 12.17.0

- `open-group-channel`: Add support for pair groupings

## 12.16.3

- `open-balanced-channel`: Fix support for node 18 digital envelope unsupported

## 12.16.2

- `probe`: Exit probe cleanly on probe success

## 12.16.1

- `balance`: Disambiguate unconfirmed and confirmed chain balances
- `call`: Fix finding arguments when selecting a method

## 12.16.0

- `swap`: Add support for responder to require a specific inbound offchain peer
- `swap`: Add support for requester to specify a custom final on-chain address

## 12.15.3

- `telegram`: Fix regression TypeError when setting up new bot api key

## 12.15.0

- Support `BOS_DATA_PATH` environment variable to override ~/.bos data dir path

## 12.14.1

- `limit-forwarding`: Fix `--only-allow` to properly parse allowed pairs

## 12.14.0

- `open-group-channel`: Add method to open balanced channels in a group tx

## 12.13.6

- `probe`: Fix probing to nodes that advertise unknown type features

## 12.13.5

- `telegram`: Add mtokens precision to rebalance messages

## 12.13.4

- Remove update notifier functionality

## 12.13.3

- `reconnect`: Stop removing peers that have an inbound disabled routing policy

## 12.13.1

- `call`: Add method to add a new advertised p2p address: `addExternalSocket`
- `call`: Add method to remove p2p addresses: `removeExternalSocket`
- `call`: Add method to update the advertised node alias: `updateAlias`
- `call`: Add method to update the advertised node color: `updateColor`
- `chain-deposit`: Add new option for NP2WPKH/P2TR addresses: `--format`

## 12.12.0

- Add `BOS_DEFAULT_LND_PATH` to set the default path to LND data directory
- Adjust support for Umbrel LND path detection

## 12.11.2

- `telegram`: Add inbound and outbound fee rates to /liquidity message

## 12.10.0

- `open`: Add support for using p2tr and multi-sig funding for external funds

## 12.9.0

- `gateway`: Add `--minutes`, `--nospend` to limit credentials validity, access

## 12.8.5

- `telegram`: Fix error logging on /blocknotify

## 12.8.4

- `telegram`: Add safeguards to deal with errors on /graph command

## 12.8.0

- `send`: Add support for specifying a LNURL or lightning.address to send to

## 12.7.1

- `swap`: Add keysend support to swap for pushing swap requests

## 12.6.5

- `probe`: Fix `feature pair exists` error when probing Eclair destinations

## 12.6.3

- `telegram`: Avoid bot crash when receiving an AMP push payment

## 12.6.1

- `lnurl`: Add support for `channel` to request an inbound channel

## 12.5.1

- `open-balanced-channel`: Correct potential future regression in signing

## 12.5.0

- `lnurl`: Add support for paying to https://lightningaddress.com/ type urls

## 12.4.1

- Add support for LND 0.14.3-beta
- `telegram`: Disallow non connect user id queries for /mempool and /version

## 12.4.0

- `chart-fees-paid`: Allow using aliases when specifying --in and --out peers

## 12.3.0

- `lnurl`: Add support for the `auth` function to authenticate with a node key

## 12.2.0

- `swap`: Add utility command for testing submarine swaps

## 12.1.0

- `lnurl`: Add support for the `withdraw` function to send a payment request

## 12.0.2

- `open-balanced-channel`: Fix display issue where `undefined` was printed

## 12.0.1

- `peers`: Add `capacity` as a variable for the `--filter` option
- `remove-peer`: Add `capacity` as a variable for the `--filter` option
- `remove-peer`: Add `--filter` option to filter the type of peer to remove

### Breaking Changes

For `peers` and `remove-peer` commands:

- `--inbound-below`: Removed option. Use `--filter "inbound_liquidity < X"`
- `--outbound-below`: Removed option. Use `--filter "outbound_liquidity < X"`

## 11.64.2

- `trade-secret`: Fix connecting when not already peered with seller

## 11.64.0

- `lnurl`: Add `--avoid`, `--max-paths`, `--out` options to control payments

## 11.63.1

- `lnurl`: Add command to decode and make payments to LNURL payRequests

## 11.62.1

- `advertise`: Optimize advertise speed when only advertising to peers

## 11.62.0

- `telegram`: Add complete amounts to forward messages, improve rate fidelity

## 11.61.3

- `chart-fees-paid`: Check HTLC attempts to confirm only counting paid fees

## 11.61.0

- `telegram`: add `--use-small-units` to avoid showing leading zeros on amounts

## 11.60.2

- `trade-secret`: Fix listing of open trades that have dynamic fiat prices

## 11.60.1

- `trade-secret`: Add support for charging dynamic fiat-based prices

## 11.59.4

- `telegram`: Fix open trade-secret serving
- `telegram`: Fix `/stop` command to require confirmation before termination

## 11.59.2

- `open-balanced-channel`: Increase fail timeout for acceptance from 5s to 90s

## 11.59.1

- `chart-fees-paid`: Fix `--rebalances` to return data

## 11.59.0

- `chart-fees-paid`: Add `--in` to filter on routes in specified node
- `chart-fees-paid`: Add `--out` to filter on routes out specified peer

## 11.58.0

- `trade-secret`: Add experimental channel sales feature

## 11.57.1

- `open`: Restructure funding flow to look for pending channels before publish

## 11.57.0

- `open`: Add `--internal-fund-at-fee-rate` to skip interactive entry

## 11.56.1

- `telegram`: Validate /connect code to be numeric and not the bot id

## 11.56.0

- `telegram`: Add support for showing `open-balanced-channel` proposals

## 11.55.0

- `telegram`: Add `/info` command to get high level node info

## 11.54.1

- `telegram`: Require connected user to use /blocknotify

## 11.54.0

- `increase-outbound-liquidity`: Add `--set-fee-rate` to set routing fee

## 11.53.11

- `telegram`: Fix handling of error posting from incorrect user ids

## 11.53.10

- `call`: Add support for including hop hints in `createInvoice`

## 11.53.9

- `call`: Add support for force-enabling when calling `enableChannel`

## 11.53.8

- `open`: Fix issue using `--set-fee-rate` when opening to new channel partners

## 11.53.6

- `change-channel-capacity`: Reduce change failure due to disconnection

## 11.53.4

- `change-channel-capacity`: Fix ExpectedEcpairObjectToUpdatePsbt error

## 11.53.1

- `change-channel-capacity`: Increase RBF delta for expand capacity flow

## 11.53.0

- `call`: Add support for `getPendingPayments` to show in-flight payments

## 11.52.5

- `open-balanced-channel`: Fix error preventing internal funding

## 11.52.4

- `telegram`: Fix crash when getting /liquidity and there is no liquidity

## 11.52.2

- `telegram`: Fix connected node offline notifications

## 11.52.1

- `fees`, `open`: Fix regression crash when setting fees on a pending channel

## 11.52.0

- `call`: Add command `getMasterPublicKeys` to list extended public keys

## 11.51.0

- `telegram`: Support notifications when a channel is pending closing

## 11.50.1

- `telegram`: Support forwards and payments with `--use-proxy`

## 11.50.0

- `open`: Add `--opening-node` to batch open channels with multiple saved nodes

## 11.49.2

- `open`: Fix crash when using `--set-fee-rate` but policy details are missing

## 11.49.1

- `telegram`: Add support for notifying of new opening channels

## 11.48.1

- `fund`: Support sending to P2TR addresses

## 11.47.2

- `telegram`: Correct open and close channel messages not posting

## 11.47.1

- `send`: Correct `max-fee-rate` parsing

## 11.47.0

- `telegram`: Add `/graph <node public key or peer alias>` to lookup node info

## 11.46.0

- `telegram`: Add `/stop` command to terminate the running bot

## 11.45.1

- `increase-inbound-liquidity`: Add support for formulas in `--amount`

## 11.44.0

- `send`: Add support for `--max-fee-rate` to limit fees paid via PPM measure

## 11.43.0

- `limit-forwards`: Add `--min-channel-confirmations` for custom channel ages
- `limit-forwards`: Add `--only-allow` to restrict forwards to allowed edges
- `open-balanced-channel`: Disallow fractional fee rate entry

## 11.42.0

- `call`: Add support for `fundPsbt` to create a funded PSBT ready to sign
- `call`: Add support for `partiallySignPsbt` to add a partial sig to a PSBT
- `call`: Add support for `signPsbt` to sign and finalize a PSBT for broadcast

## 11.41.0

- `remove-peer`: Add interactive mode to select channels to close

## 11.40.0

- `peers`: Add `DISK_USAGE_MB` filter to `--filter` formulas for est disk usage
- `peers`: Add `est_disk_usage_mb` to allowed `--sort` fields

## 11.39.0

- `limit-forwarding`: Add new command to limit allowed routing

## 11.38.0

- `advertise`: Add support for `--max-hops` to specify a maximum graph distance
- `advertise`: Add support for `--min-hops` to specify a minimum graph distance

## 11.37.0

- `advertise`: Add support for specifying a maximum ad spend with `--budget`

## 11.36.3

- `telegram`: Add support for `--use-proxy` to specify a SOCKS proxy server

## 11.35.0

- `graph`: Add `HOPS` variable to `--filter` for node peer distance from self

## 11.34.0

- `telegram`: Allow switching the node of a trade-secret

## 11.33.0

- `telegram`: Allow adjusting the expiration date of a trade-secret

## 11.32.1

- `change-channel-capacity`: Add support for moving a channel to a different
    saved node.

## 11.31.0

- `forwards`: Add `--sort` option to sort forwarding peers

## 11.30.0

- `telegram`: Add support for setting the description of a created trade-secret

## 11.29.2

- `increase-outbound-liquidity`: Change seed node backing endpoint for API EOL

## 11.29.1

- `inbound-liquidity`: Remove `--min-score` due to score API EOL

## 11.29.0

- `telegram`: Add support for deleting open-ended trade-secrets

## 11.28.0

- `telegram`: Add support for serving open-ended trade-secrets

## 11.27.0

- `change-channel-capacity`: Add support for spending decreased funds into a
    new channel with a different node.

## 11.26.1

- `call`: methods `pay`, `payViaPaymentRequest`: Fix support for
    `outgoing_channels` constraint

## 11.26.0

- `call`: Add support for `deletePendingChannel` to remove stuck pending chans

## 11.25.0

- `trade-secret`: persist open trades, with expiration dates and longer-lived
    trade support.
- `trade-secret`: show the raw encoded trade after requesting an open trade
- `trade-secret`: confirm RPC signer support before allowing trade start

## 11.24.0

- `fees`: Add `--set-cltv-delta` to control the forwarding CLTV delta with peer

## 11.23.0

- `balance`:  `--detailed`: Support unconfirmed/invalid/conflicting balances

## 11.22.4

- `telegram`: Fix issue when moving a created invoice to a saved node

## 11.22.0

- `accounting`: Add summation total as secondary table

## 11.20.2

- `change-channel-capacity`: Increase RBF fee buffer when increasing capacity
- `telegram`: Redesign /invoice user interface to be button based

## 11.20.1

- `fees`: Correct issue where fee rate could not be set to zero

## 11.20.0

- `send`: Add support for paying to zero-amount BOLT 11 payment requests

## 11.19.0

- `change-channel-capacity`: Allow changing private/public status of channel

## 11.18.1

This release fixes an important issue with the experimental
`change-channel-capacity` command. Do not use this command on past versions.

- `change-channel-capacity`: Fix failure to preserve announce flags
- `trade-secret`: The public key of the peer to trade with is now optional

## 11.17.0

- `change-channel-capacity`: Add command to adjust channel capacity up or down

## 11.16.2

- Address Docker image installation issues
- `open-balanced-channel`: Move up indicator of waiting for incoming channel

## 11.16.1

- `send`: Add support for global ignores from `tags` when `--avoid` unspecified

## 11.16.0

- `open-balanced-channel`: Add `--coop-close-address` to add a close-to-address

## 11.15.0

- `inbound-channel-rules`: Add `--coop-close-address` to request close address

## 11.14.0

- `open-balanced-channel`: Add support for accepting using p2p messaging
- `open-balanced-channel`: Add support for regtest network

## 11.13.0

- `open`: Add `--coop-close-address` to specify cooperative close addresses

## 11.12.1

- `call`: Add `deletePayment`, `pay`, `subscribeToPayViaRequest`, `getMethods`,
    `disconnectWatchtower`, `updateConnectedWatchtower` methods

## 11.11.0

- `advertise`: Add `--dryrun` to skip actually sending ads
- `advertise`: Add `--filter` to target nodes with specified capacities, channel counts
- `swap-in`: Fix command to execute when there is a liquidity lookup needed

## 11.10.0

- `find`: Add estimated disk usage to channels with a peer
- `price`: Add coinbase as a fiat rate provider
- `rebalance`: Allow rebalancing `--in` and `--out` of the same tag
- `rebalance`: Fix error message when `--in-filter` and `--out-filter` return no matches
- `rebalance`: Add `pending_payments` variable to `--in-filter` and `--out-filter`
- `telegram`: Improve uptime reliability across connectivity errors

## Version 11.9.0

- `chart-fees-earned`: Add tag support to view fees earned via tagged nodes
- `inbound-liquidity`: Add tag support to `--with` to view inbound for a tag
- `open-balanced-channel`: Fix issue connecting to peer when accepting balanced channel
- `outbound-liquidity`: Add tag support to `--with` to view outnbound for a tag

## Version 11.8.2

- `call`: Add support for `sendMessageToPeer`, `subscribeToPeerMessages`
- `telegram`: Report outgoing payments
- `trade-secret`: Add a command to create or decode secret trades

## Version 11.7.3

- `telegram`: Add title to `/liquidity` output when a peer is referenced

## Version 11.7.1

- `chart-fees-paid`: Increase precision of total fees paid

## Version 11.7.0

- `fund`: Add `MAX` variable to allow spending down specified UTXOs

## Version 11.6.2

- `clean-failed-payments`: Add method to clean out failed past payments

## Version 11.5.1

- `--avoid`: Correct naming`OUT_FEE_RATE`/`IN_FEE_RATE` to `OPPOSITE_FEE_RATE`

## Version 11.5.0

- `--avoid` Add `IN_FEE_RATE` and `OUT_FEE_RATE` to formulas
- `find`: Correct socket output for peer node lookups
- `telegram`: Correct week summary chain fee costs in `/costs`

## Version 11.4.0

- `call`: Add `--param` flag to pass arguments directly instead of interactively

## Version 11.3.0

- `credentials`: Allow specifying specific methods to allow in a credential

## Version 11.2.1

- Improve support for LND v0.13.3

## Version 11.2.0

- `rebalance`: Add support for `key/formula` expressions in `--avoid`

## Version 11.1.0

- `avoid`: Add `capacity` to reference channel capacity amount
- `call`: Add support for force closing a channel
- `find`: Improve lookup speed when querying a tx id or peer
- `open-balanced-channel`: Avoid showing incoming requests that were accepted
- `rebalance`: Add `capacity` variable to `--in-filter` and `--out-filter`
- `transfer`: Add `in_inbound` and `in_outbound` variables to amount formulas

## Version 11.0.0

- `rebalance`: Add `--in-filter` to filter inbound tagged nodes
- `rebalance`: Add `--out-filter` to filter outbound tagged nodes

### Breaking Changes

- `market`: Remove command, 3rd party service powering fiat rates was discontinued
- `rebalance`: Remove `--out-channel` support, use `--out-filter` vs `heights` instead

## Version 10.20.0

- `graph`, `peers`: Add `--filter` option to filter out peers that do not match formulas

## Version 10.19.0

- `balance`: Included locked UTXO value as on-chain value in `--detailed` balance output
- `increase-inbound-liquidity|pay|probe|rebalance|send`: Add `AGE` to avoid formulas
- `peers`: Avoid errors when network name is unknown
- `push`: Add `--message-omit-from-key` to send messages without including "from" key

## Version 10.18.1

- `open`: In final tx id indication use original external tx id when available

## Version 10.18.0

- `call`: Add support for `broadcastChainTransaction`, `cancelHodlInvoice`
    `cancelPendingChannel`, `createChainAddress`, `createHodlInvoice`, `deletePayments`,
    `settleHodlInvoice`, `subscribeToBackups`, `subscribeToBlocks`,
    `subscribeToChannels`, `subscribeToForwards`, `subscribeToGraph`,
    `subscribeToInvoice`, `subscribeToInvoices`, `subscribeToPeers`,
    `subscribeToTransactions`.
- `services`: Add service `--invoice` to create invoices on request
- `services`: Automatically retry on `relay` service if destination payment fails

## Version 10.17.0

- `chart-fees-paid`: Add tag icons to nodes in table view
- `telegram`: Add `/costs` command to report rebalance and chain fees

## Version 10.16.2

- `chart-chain-fees`: Add mempool space chain fee lookup redundancy
- `open-balanced-channel`: Add additional logging on initial connectivity probe

## Version 10.16.1

- `chart-chain-fees`: Increase execution speed for non-exhaustive charts

## Version 10.16.0

- `chart-fees-paid`: Add `--rebalances` for looking up only rebalancing fees paid

## Version 10.15.0

- `increase-inbound-liquidity`: Add support for avoiding channels, tags, formulas

## Version 10.14.3

- `open`: Run preflight checks on nodes to confirm opening parameters will be accepted

## Version 10.14.2

- `peers`: Use full fee values to calculate fees earned to improve accuracy of earnings

## Version 10.14.1

- `services`: Fix `--relay` service to charge correct amount

## Version 10.14.0

- `services`: Add support for `--connect` to enable requesting a peer connection

## Version 10.13.1

- `services`: Fix fee calculation on relay service requests

## Version 10.13.0

- `fund`: Add `--select-utxos` option to interactively select UTXOs for funding
- `rebalance`: Fix minutes timeout not terminating rebalance on time
- `services`: Fix responding to service requests

## Version 10.12.0

- `send`: Add `--avoid` to avoid keys/channels/tags/formulas in pathfinding

## Version 10.11.1

- `rebalance`: Fix recognition of pubkey/pubkey style directed pair avoidance

## Version 10.11.0

- `accounting`: Remove non-fee sweep amounts
- `open`: Wait for chain fee entry before attempting channel open when using internal funds
- `open`: Increase speed of internal UTXO lock canceling when internal funding open fails
- `rebalance`: Add formula support to avoids for in-policy avoiding
- `rebalance`: Automatically retry on liquidity contention and other remote errors
- `transfer`: Add tag icons to route evaluation output

## Version 10.10.2

- `balance`: For off-chain balances, switch commitment fee adjustment to credit for commit fees

## Version 10.10.1

- `open`: Fix crash when using external funds

## Version 10.10.0

- `open-balanced-channel`: Add support for using internal wallet funds to initiate open

## Version 10.9.2

- `chart-fees-earned`: Fix forwards in closed channels not counting for pubkey charts
- `forwards`: Show HTLC in-flight indicator when there is a pending payment
- `open-balanced-channel`: Reduce superfluous tx broadcast error reporting

## Version 10.9.1

- `accounting`: Change default fiat rate provider to coingecko

## Version 10.9.0

- `open`: Add support for using internal funds to open channels
- `open`: Add `--external-funding` flag to force external funding flow

## Version 10.8.1

- `remove-peer`: Allow coop closing channel with peer when unselected chan has pending htlcs

## Version 10.8.0

- `recover-p2pk`: Add hidden command to allow recovering funds sent to the node identity key

## Version 10.7.11

- `remove-peer`: When specifying a public key directly, check to confirm can cooperative close

## Version 10.7.10

- `fund`: Disallow funding outputs that are public keys instead of regular chain-addresses

## Version 10.7.9

- `probe`: Improve compatibility with destinations that require a payment nonces on lnd 0.12.1

## Version 10.7.8

- `price`: Add hints for which rate providers are supported
- `telegram`: Add response consistency to /pending with /liquidity and /backup on no connect id

## Version 10.7.7

- `transfer`: Add `--through` flag as a shorthand for setting equal `--in` and `--out`

## Version 10.7.6

- `fund`: Show the sum of all outputs when funding a transaction

## Version 10.7.5

- `fund`: Fix `--dryrun` to unlock UTXOs after funding

## Version 10.7.4

- `call`: Update help to show how to use when a method name is unknown
- `reconnect`: Remove logging when removing a peer for cycling

## Version 10.7.3

- `telegram`: Fix issues running on nodes that have special characters in their alias

## Version 10.7.2

- `pay`, `probe`, `rebalance` - add support for pubKey/pubKey in `--avoid` for avoiding a pair

## Version 10.7.1

Update dependencies to improve support for LND 0.13.1

- `fees`: Show error when trying to set fees but not specifying any peers to set fees to
- `graph`: Change query via alias to only work on direct peers
- `peers`: Add icon to indicate if a peer is restricting their maximum HTLC size
- `tags`: Fix issues with entering uppercase tag names
- `transfer`: Add default description for transfer invoices

## Version 10.7.0

- `pay`: Expand `--avoid` support to avoiding channels and tags and peer aliases/pubkeys
- `probe`: Expand `--avoid` support to avoiding channels and tags and peer aliases/pubkeys
- `telegram`: Fix `/pay` command when paying to nodes that require payment nonces
- `telegram`: Fix `/pay` command responding with error when no budget is set for payments

## Version 10.6.2

- `open`: Fix ExpectedFinalScriptSigsAndWitnesses error when supplying some PSBTs

## Version 10.6.1

- `graph`: Fix error when querying for a node by its alias or public key start

## Version 10.6.0

Fixed issues with LND builds that do not report a commit hash in version information

- `open-balanced-channel`: Add `--recover` option to recover funds accidentally sent

## Version 10.5.2

Avoid auto-detecting LND socket when TLS + Tor is configured

## Version 10.5.1

- `telegram`: Aggregate forward notifications between identical simultaneous pairs
- `utxos`: On LND 0.13.0 support listing locked UTXOs in output

## Version 10.5.0

- `call`: Fix regression in 10.3.0 that introduced additional command latency
- `graph`: Add new command to lookup a node and its peers in the graph
- `reconnect`: Change to be more aggressive in reconnecting disabled peers

## Version 10.4.3

- `accounting`: Add support for AMP push payments

## Version 10.4.2

- `peers`: Correct issue when receiving AMP push payments

## Version 10.4.1

- `open`: Use BIP 0069 sorting when displaying addresses and amounts to send to

## Version 10.4.0

- `transfer`: Add command to transfer funds between saved nodes

## Version 10.3.0

- `call`: Add command to call APIs directy

## Version 10.2.0

- `fees`: Reference other nodes' fees in `--set-fee-rate` using `FEE_RATE_OF_<PUBKEY>`

## Version 10.1.1

- `telegram`: Show errors when starting telegram bot fails
- `telegram`: Reformat rebalance, forward, receive messages to use standard amount format
- `telegram`: Add fee rate info to rebalance/forward messages

## Version 10.1.0

- `open`: Add `--set-fee-rate` to set forwarding fee rates after opening channels
- `peers`: Increase execution speed when not specifying idle days or fee earnings

## Version 10.0.0

- `increase-inbound-liquidity`: Fix erroneously canceling swap when using a single path
- `increase-outbound-liquidity`: Fix erroneous chain-fee output for dry-run, specifying fee rate
- `open`: Show `fund` formatted command arguments
- `pay`: Fix paying payment requests that specify millitokens
- `pay`: Show tag icons on path descriptions
- `probe`: Show payment request details when specifying a payreq
- `peers`: Return error when specifying an unknown tag
- `probe`: Show tag icons on path descriptions
- `probe`: Show payment request details when specifying a payreq
- `services`: Fix restarting on connection failures
- `services`: Add `relay` service to create a relaying payment request
- `telegram`: Add `--reset-api-key` to allow changing the saved API key
- `telegram`: Confirm supported nodejs version installed before attempting to start bot
- `use`: Add support for payment request arguments
- `use`: Fix interactively paying for a paywall

### Breaking Changes

- `rebalance`: Remove `--avoid-high-outbound`, use `--out-target-inbound` instead
- `services`: Add support for requiring a payment request as an argument

## Version 9.4.1

- `telegram`: Fix issue where auto-restarting due to loss of connectivity could break commands

## Version 9.4.0

- `increase-inbound-liquidity`: Cleanly request cancel of open HTLC on failure

## Version 9.3.0

- `services`: Add `activity` service support to share routing activity over keysend

## Version 9.2.0

- `fees`: Add support for setting fees on nodes by a tag, show tag icons

## Version 9.1.0

- `accounting`: Add `--disable-fiat` flag to avoid fiat conversions on rows

## Version 9.0.0

- `inbound-channel-rules`: Show error when calling without arguments
- `services`: Add command to respond to keysend paid service requests
- `telegram`: Fix error message shown when trying to pay with no budget
- `use`: Add command to make keysend paid service requests

### Breaking Changes

- `chain-receive`: Rename command to `swap-in`
- `purchase-ping`: Remove command use `use` instead
- `service-keysend-requests`: Remove command, use `services` instead

## Version 8.0.14

- `closed`: Fix issue when proposed channels that never existed are abandoned

## Version 8.0.13

- `pay`: Throw error when avoid is not a public key
- `probe`: Throw error when avoid is not a public key

## Version 8.0.12

- `open-balanced-channel`: Allow parent tx time to enter mempool before child spend

## Version 8.0.11

- `telegram`: Fix error on command /connect when already connected

## Version 8.0.10

- `fees`: Ignore pending closing channels when setting fees

## Version 8.0.9

- `increase-inbound-liquidity`: Fix `show-raw-recovery` when fees are very high

## Version 8.0.8

- `peers`: Show emoji when peer inbound forwarding is disabled

## Version 8.0.7

- `increase-inbound-liquidity`: Allow for higher routing fee to start swap.

## Version 8.0.6

- Add autocomplete guidance to the README

- `rebalance`: Show effective fee rate paid to rebalance
- `telegram`: Send error message to telegram when node goes offline

## Version 8.0.5

- Adjust default lnd dir for Umbrel's default lnd dir location

## Version 8.0.4

- `rebalance`: Add support for specifying a list of nodes to `avoid` by specifying a tag

## Version 8.0.3

- `find`: Lookup node by start of public key
- `service-keysend-requests`: Use an alternative node to pay response requests
- `tags`: Fix issue when setting avoid on a tag without adjusting icon or keys

## Version 8.0.2

- `rebalance`: Show node icons in route descriptions

## Version 8.0.0

Support is ended for nodejs 10, nodejs 12 or higher is required

- `find`: Indicate if a peer initiated a found channel
- `telegram`: Add `/pending` command to view pending HTLCs and channels

## Version 7.19.0

- `peers`: Add `--tag` option to show only one or more tags in the output

## Version 7.18.2

Remove support for auto-detecting TLS IP

- `advertise`: Add method to advertise your node over KeySend to the network
- `telegram`: Add `ignore-forwards-below` option to not be notified on small forwards
- `telegram`: Avoid retrying /liquidity when a peer match is not found

## Version 7.17.2

- `gateway`: Fix error logging when starting gateway
- `inbound-channel-rules`: Fix error when passing rules
- `rebalance`: Avoid selecting the same out node as the inbound tag node
- `telegram`: Improve reliability of /liquidity command

## Version 7.17.1

- `accounting`: Fix for error when chain transactions list is missing required input data

## Version 7.17.0

- `open`: Add `type` to allow specifying a private or public channel type

## Version 7.16.0

- `send`: Add support for sending a quiz to a recipient
- `telegram`: Add support for checking the current and latest version with `/version`
- `telegram`: Display interactive quizzes that are sent as KeySends
- `telegram`: Mark unconfirmed on-chain transactions as pending

## Version 7.15.3

- `send`: Fix error message when failing to send
- `telegram`: Avoid writing API key when key is already written

## Version 7.15.2

- `gateway`: Fix subscription closing when web socket closes
- `send`: Fix `max_fee` setting

## Version 7.15.1

- `forwards`: Stop showing no-channel peers as being private peers
- `send`: Fix error when sending out a peer that has an active HTLC

## Version 7.15.0

- `forwards`: Show icon when a peer has part of their liquidity in a pending channel
- `forwards`: Show icon when a peer has no public channels
- `peers`: Show icon when a peer has part of their liquidity in a pending channel
- `reconnect`: Cycle peers that are connected but the outgoing forwarding policy is disabled
- `send`: Add `--in` and `--out` constraints to specify inbound and outbound hops
- `send`: Add `OUT_INBOUND`, `OUT_LIQUIDITY`, `OUT_OUTBOUND` as amount formula variables

## Version 7.14.0

- `balance`: Add `--detailed` option to get a breakdown of various component balances
- `closed`: Indicate channel close transaction fees paid
- `increase-inbound-liquidity`: Confirm that the output address looks like an address

## Version 7.13.0

- `rebalance`: Add support for specifying a tag group to rebalance `--in` or `--out`

## Version 7.12.0

- `remove-peer`: Fix error running command
- `remove-peer`: Add `--outpoint` to specific specific channels to close

## Version 7.11.1

- `report`: Fix error running command

## Version 7.11.0

- `tags`: Add method to create groupings of public keys
- `tags`: Add `--avoid` flag to always avoid a set of peers in `rebalance`
- `tags`: Add `--icon` flag to show icons next to peers in `forwards`, `peers`

## Version 7.10.1

- `accounting`: Fix chain accounting on testnet
- `accounting`: Add additional labeling to tx with descriptions and push payments received

## Version 7.10.0

- `broadcast`: Add command to broadcast a signed raw transaction

## Version 7.9.0

- `fund`: Allow specifying `--utxo` to force selection of specific UTXOs for funding
- `fund`: Add `--dryrun` to immediately unlock UTXOs for future coin selection

## Version 7.8.0

- `utxos`: Add metadata context information to UTXO list

## Version 7.7.1

- `chart-fees-paid`: Optimize render speed by paging payments fetching
- `inbound_channel_rules`: Add `CHANNEL_AGES` testing for rule creation
- `peers`: Optimize speed when using `--idle-days` by paging payments fetching
- `peers`: Show icon when peer has an active HTLC
- `report`: Optimize render speed by paging payments fetching
- `send`: Add `dryrun`, `max-fee` options, formula support including USD/EUR and liquidity vars

## Version 7.6.0

- `inbound-channel-rules`: Add method to enforce rules for accepting inbound channels

## Version 7.5.2

- `closed`: Clarify the closing party in the cooperative case
- `gift`: Add support for payment identifiers
- `rebalance`: Add support for payment identifiers

## Version 7.5.1

- `reconnect`: Add an execution timeout to reconnecting

## Version 7.5.0

- `open-balanced-channel`: Add command to open channel with dual-sided funding

## Version 7.4.3

- `increase-inbound-liquidity`: Fix issue preventing mainnet usage

## Version 7.4.2

- `fund`: Fix issue setting fee rate
- `peers`: Add icon for private peers
- `peers`: Fix icon for cooperative close delay peers

## Version 7.4.1

- `fees`, `peers`: Standardize peer alias display
- `find`: Show connected and past connected channels with a peer match
- `find`: Show large channel support for peer matches
- `peers`: Add display of cooperative close delays, pending forwards, and low uptime status

## Version 7.4.0

- `chain-receive`: Add support for MPP receiving

## Version 7.3.3

- `telegram`: Fix a stability issue that could interfere with auto-restarting

## Version 7.3.2

Start speed of all commands is increased.

## Version 7.3.1

- `accounting`: Includes close channel chain fees in the chain-fees category
- `chart-chain-fees`: Accurately portray channel close chain fees in chart
- `telegram`: Improve stability across network disconnections

## Version 7.3.0

- `purchase-ping`: Add method to make a ping keysend request to a node
- `service-keysend-requests`: Add method to auto-pay pongs back to incoming pings

## Version 7.2.7

- `accounting`: Includes sweep chain fees in the chain-fees category
- `chart-chain-fees`: Accurately portray sweep fees in chart

## Version 7.2.4

- `pay`, `probe`: Fix error when describing a probe of a route where there is only one hop

## Version 7.2.3

- `reconnect`: Attempt to fix channels that are inactive but peers are still connected

## Version 7.2.1

- `forwards`: Fix issue where forwards in closed channels were not represented in output

## Version 7.2.0

- `fund`: Add method to create a signed raw transaction using on-chain funds

## Version 7.1.0

- `chart-chain-fees`: Add method to show chain fees paid over time

## Version 7.0.0

- Support for versions of LND lower than v0.11.0 is discontinued

## Version 6.5.2

- `increase-inbound-liquidity`: Increase default maximum wait time
- `telegram`: Improve stability of `/blocknotify`

## Version 6.5.1

- `increase-inbound-liquidity`: Fix support for recovery mode in new swap versions

## Version 6.5.0

- `open`: Using formulas like `0.1*btc` is supported when specifying `--amount`
- `probe`: Using formulas like "0.1*btc" is supported when specifying `<amount>`
- `rebalance`: Using formulas is supported in `in-target-outbound`, `out-target-inbound`
- `rebalance`: Using `CAPACITY` as a formula variable is supported for target inbound/outbound

## Version 6.4.0

- `accounting`: Improve the speed and reduce the backend burden of getting payment records
- `credentials`: Allow exporting credentials without spending privileges: `--nospend`
- `credentials`: Allow exporting credentials with read-only privileges: `--readonly`
- `delete-payments-history`: Add "hidden" command to allow deleting all payment records
- `increase-inbound-liquidity`: Fix issue when attempting without a specified API key
- `telegram`: Improve automatic recovery in situations where errors are encountered
- `telegram`: Reveal unverified "from" public key when receiving keysends with invalid signatures

## Version 6.3.2

- `increase-inbound-liquidity`: Backup on-chain recovery to safeguard swap completion

## Version 6.3.1

- `closed`: Increase speed and reduce calls by checking against local transaction data

## Version 6.3.0

- `increase-inbound-liquidity`: Fix errors encountered during pathfinding
- `increase-inbound-liquidity`: Allow specifying a peer alias or abbreviated key in `--with`
- `rebalance`: Allow specifying formulas for `--amount`, including `*k`,`*m`, `*btc`

## Version 6.2.1

- `chain-receive`: Fix method on testnet
- `increase-inbound-liquidity`: Fix method on testnet

## Version 6.2.0

- `fees`: Allow specifying formulas with `--set-fee-rate`, including INBOUND_FEE_RATE

## Version 6.1.0

- `rebalance`: Improve support for very small rebalances, validate too-small rebalances
- `telegram`: Add `/earnings` command to show weekly forward and invoice earnings

## Version 6.0.0

- `telegram`: Remove the option to sync LND to a local database

### Breaking Changes

- `telegram` no longer accepts the `--disable-sync` option

## Version 5.47.0

- `open`: Add the option to gift funds to the peer on channel open

## Version 5.46.9

- `accounting`: Add fix for a regression in `accounting chain-fees` causing error

## Version 5.46.8

- `increase-inbound-liquidity`: Add `max-deposit` to adjust max allowed deposit
- `increase-inbound-liquidity`: Show accurate service fee estimate for non-fast swaps

## Version 5.46.7

- `accounting`: Add fix for a regression in `accounting payments` causing error

## Version 5.46.6

- `accounting`: Switch default rate provider to coincap
- `chain-receive`: Upgrade to v2 on-chain swap script
- `increase-inbound-liquidity`: Upgrade to v2 on-chain swap script

## Version 5.46.5

- `probe`: Fix issue describing route

## Version 5.46.4

- `increase-inbound-liquidity`: Allow for higher deposit percentage requirement

## Version 5.46.3

- `telegram`: Updated /help to include /liquidity command

## Version 5.46.2

Added additional instructions for Docker usage in README.md

- `nodes`: Show empty nodes list if there is no home directory

## Version 5.46.1

- `fees`: Tolerate LND setting fees inaccurately by 1 ppm
- `gateway`: Allow generating credentials for a remote URL
- `increase-inbound-liquidity`: Increase default confirmation target time
- `telegram`: Improve stability of long-running bot

## Version 5.46.0

- `forwards`: Add `--in` to show forwards from a specified peer
- `forwards`: Add `--out` to show forwards to a specified peer
- `increase-inbound-liquidity`: Reenable swap final output logging

## Version 5.45.0

- `gateway`: Add gateway service to allow connecting web applications

## Version 5.44.1

- `increase-inbound-liquidity`: Add error checking for server create swap errors
- `telegram`: Disable web previews triggered by aliases

## Version 5.44.0

- `telegram`: Add `blocknotify` command to be notified on the next block

## Version 5.43.4

- `fanout`: Correct error reporting
- `fees`: Correct error reporting
- `find`: Correct error reporting

## Version 5.43.3

- `forwards`: Correct issue displaying forwards when window size is unknown
- `peers`: Correct issue displaying peers when window size is unknown

## Version 5.43.2

- `pay`: Fix pay not working when both --out and --max-paths were specified

## Version 5.43.1

- `open`: Fix signature validity in some native segwit signing scenarios

## Version 5.43.0

- `chart-fees-earned`: Add `--forwarded` option to show total amount forwarded
- `telegram`: Add `/liquidity` command to show overall liquidity, or with a peer

## Version 5.42.1

- `telegram`: Add command hinting autocomplete registration on bot start

## Version 5.42.0

- `pay`: Add `--max-paths` option to attempt paying through multiple paths
- `pay`: Allow paying through multiple out peers when multiple paths specified
- `probe`: Allow probe through multiple out peers when multiple paths specified

## Version 5.41.6

- `probe`: Fix probing payment requests

## Version 5.41.5

- `increase-inbound-liquidity`: Fix `--recovery` option
- `probe`: Rework `--find-max` methodology

## Version 5.41.3

- `increase-inbound-liquidity`: Support longer swap timeouts

## Version 5.41.2

- `probe`: Add `--max-paths` option to inform `--find-max` probing
- `telegram` Improve database-sync reliability

## Version 5.41.0

- `fees`: Add command to list outgoing fee rates and to set fee rates to a peer
- `open`: Show more details regarding deadline and opening process, addresses
- `telegram`: Improve reliability when local connection is interrupted

## Version 5.40.2

Fix compatibility issues with node version 14

- `telegram`: Add `--disable-sync` flag to turn of background db sync
- `telegram`: Improve reliability when backing node is disconnected

## Version 5.40.1

- `telegram`: Fix add more context to rebalance reports
- `telegram`: Add `/mempool` command to show mempool.space details

## Version 5.39.9

- `open`: Fix open with unconnected peer, improve reliability

## Version 5.39.8

- `open`: Log cancel pending channel actions
- `report`: Show decrease liquidity side on rebalances

## Version 5.39.7

- `market`: Remove method from help due to API unreliability
- `probe`: Fix probing non-legacy requests when amount is zero
- `report`: Fix unit reporting of inbound and outbound liquidity

## Version 5.39.6

- `telegram`: Add background sync with backing LND nodes

## Version 5.39.5

- `accounting`: Fix potential race condition in report generation
- `chain-receive`: Fix dependency issue relating to API token changes
- `peers`: Fix issue when there are no results to a peers query

## Version 5.39.4

- `increase-inbound-liquidity`: Reduce failures when specifying large amounts

## Version 5.39.3

- `probe`: Fix probing destinations that are not known in the graph

## Version 5.39.2

- `probe`: Fix probing destinations that advertised unrecognized features

## Version 5.39.1

- `increase-inbound-liquidity`: Improve reliability of multi-path routes

## Version 5.39.0

- `increase-inbound-liquidity`: Add `--max-paths` to limit routing paths taken

## Version 5.38.6

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
