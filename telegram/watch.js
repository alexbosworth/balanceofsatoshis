const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncMap = require('async/map');
const {describeAttemptPaymentFail} = require('ln-sync');
const {describeAttemptPaymentSent} = require('ln-sync');
const {describeAttemptingPayment} = require('ln-sync');
const {describeBaseFeeUpdated} = require('ln-sync');
const {describeBlockAdded} = require('ln-sync');
const {describeChannelAdded} = require('ln-sync');
const {describeChannelClosed} = require('ln-sync');
const {describeChannelDisabled} = require('ln-sync');
const {describeChannelEnabled} = require('ln-sync');
const {describeFeeRateUpdated} = require('ln-sync');
const {describeForwardFailed} = require('ln-sync');
const {describeForwardStarting} = require('ln-sync');
const {describeForwardSucceeded} = require('ln-sync');
const {describeHtlcReceived} = require('ln-sync');
const {describeMaxHtlcUpdated} = require('ln-sync');
const {describeMinHtlcUpdated} = require('ln-sync');
const {describeNodeAdded} = require('ln-sync');
const {describePaymentRejected} = require('ln-sync');
const {describePeerConnected} = require('ln-sync');
const {describePeerDisconnected} = require('ln-sync');
const {describePeerReconnected} = require('ln-sync');
const {describePolicyCltvUpdated} = require('ln-sync');
const {describePolicyDisabled} = require('ln-sync');
const {describePolicyEnabled} = require('ln-sync');
const {describeProbeReceived} = require('ln-sync');
const {getWalletInfo} = require('ln-service');
const {logLineForChangeEvent} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const {subscribeToChanges} = require('ln-sync');
const {syncCurrentRecords} = require('ln-sync');

const {getLnds} = require('./../lnd');

const {isArray} = Array;
const mode = 'local';

/** Watch syncing happening in relation to nodes

  {
    db: <Database Object>
    logger: <Winston Logger Object>
    nodes: [<Node Name String>]
  }

  @returns via cbk or Promise
*/
module.exports = ({db, logger, nodes}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!db) {
          return cbk([400, 'ExpectedDatabaseToWatchNodes']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToWatchNodes']);
        }

        if (!isArray(nodes)) {
          return cbk([400, 'ExpectedArrayOfNodesToWatch']);
        }

        return cbk();
      },

      // Get LNDs
      getLnds: ['validate', ({}, cbk) => getLnds({logger, nodes}, cbk)],

      // Get the public keys of the nodes
      getKeys: ['getLnds', ({getLnds}, cbk) => {
        return asyncMap(getLnds.lnds, (lnd, cbk) => {
          return getWalletInfo({lnd}, cbk);
        },
        cbk);
      }],

      // Backfill records
      syncRecords: ['getLnds', ({getLnds}, cbk) => {
        return asyncEach(getLnds.lnds, (lnd, cbk) => {
          return syncCurrentRecords({db, lnd}, cbk);
        },
        cbk);
      }],

      // Start watching for new records
      syncChanges: ['getKeys', 'getLnds', ({getKeys, getLnds}, cbk) => {
        const fromNodes = nodes.map((node, i) => {
          return {node, lnd: getLnds.lnds[i]};
        });

        return asyncEach(fromNodes, async ({lnd, node}, cbk) => {
          let sub;

          try {
            sub = subscribeToChanges({db, lnd});
          } catch (err) {
            return cbk([503, 'FailedToSubscribeToChanges', {err}]);
          }

          sub.on('attempt_payment_sent', async payment => {
            try {
              const {description} = await describeAttemptPaymentSent({
                db,
                mtokens: payment.mtokens,
                out_channel: payment.out_channel,
                public_key: payment.public_key,
              });

              const event = 'attempt_payment_sent';

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('attempt_payment_failed', async payment => {
            try {
              const {description} = await describeAttemptPaymentFail({
                db,
                mtokens: payment.mtokens,
                out_channel: payment.out_channel,
                public_key: payment.public_key,
              });

              const event = 'attempt_payment_failed';

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('attempting_payment', async payment => {
            try {
              const {description} = await describeAttemptingPayment({
                db,
                mtokens: payment.mtokens,
                out_channel: payment.out_channel,
                public_key: payment.public_key,
              });

              const event = 'attempting_payment';

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('block_added', async block => {
            const {description} = describeBlockAdded(block);
            const event = 'block_added';

            const {line} = logLineForChangeEvent({description, event, mode});

            return !!line ? logger.info(line) : null;
          });

          sub.on('channel_added', async channel => {
            try {
              const event = 'channel_added';
              const {id} = channel;

              const {description} = await describeChannelAdded({db, id});

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('channel_closed', async channel => {
            try {
              const event = 'channel_closed';
              const {id} = channel;

              const {description} = await describeChannelClosed({db, id});

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('channel_disabled', async channel => {
            try {
              const event = 'channel_disabled';

              const {description} = await describeChannelDisabled({
                db,
                id: channel.id,
                public_key: channel.public_key,
              });

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('channel_enabled', async channel => {
            try {
              const event = 'channel_enabled';

              const {description} = await describeChannelEnabled({
                db,
                id: channel.id,
                public_key: channel.public_key,
              });

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('disconnected', async disconnected => {
            try {
              const event = 'disconnected';

              const {description} = await describePeerDisconnected({
                db,
                node: disconnected.node,
                from: disconnected.from,
              });

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('error', err => logger.error({err, node}));

          sub.on('failed_forward', async forward => {
            try {
              const event = 'failed_forward';

              const {description} = await describeForwardFailed({
                db,
                in_channel: forward.in_channel,
                internal_failure: forward.internal_failure,
                mtokens: forward.mtokens,
                out_channel: forward.out_channel,
                public_key: forward.public_key,
              });

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('forwarded_payment', async forward => {
            try {
              const event = 'forwarded_payment';

              const {description} = await describeForwardSucceeded({
                db,
                fee_mtokens: forward.fee_mtokens,
                in_channel: forward.in_channel,
                mtokens: forward.mtokens,
                out_channel: forward.out_channel,
                public_key: forward.public_key,
              });

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('forwarding', async forward => {
            try {
              const event = 'forwarding';

              const {description} = await describeForwardStarting({
                db,
                in_channel: forward.in_channel,
                mtokens: forward.mtokens,
                out_channel: forward.out_channel,
                public_key: forward.public_key,
              });

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('new_peer', async details => {
            try {
              const event = 'new_peer';

              const {description} = await describePeerConnected({
                db,
                node: details.node,
                to: details.to,
              });

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('node_added', async node => {
            try {
              const event = 'node_added';

              const {description} = await describeNodeAdded({
                db,
                id: node.public_key,
              });

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('policy_base_fee_updated', async policy => {
            try {
              const event = 'policy_base_fee_updated';

              const {description} = await describeBaseFeeUpdated({
                db,
                id: policy.id,
                local_keys: getKeys.map(n => n.public_key),
                previous: policy.previous,
                public_key: policy.public_key,
                updated: policy.updated,
              });

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('policy_cltv_delta_updated', async policy => {
            try {
              const {description} = await describePolicyCltvUpdated({
                db,
                id: policy.id,
                local_keys: getKeys.map(n => n.public_key),
                previous: policy.previous,
                public_key: policy.public_key,
                updated: policy.updated,
              });

              const event = 'policy_cltv_delta_updated';

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('policy_disabled', async policy => {
            try {
              const {description} = await describePolicyDisabled({
                db,
                id: policy.id,
                local_keys: getKeys.map(n => n.public_key),
                public_key: policy.public_key,
              });

              const event = 'policy_disabled';

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('policy_enabled', async policy => {
            try {
              const {description} = await describePolicyEnabled({
                db,
                id: policy.id,
                local_keys: getKeys.map(n => n.public_key),
                public_key: policy.public_key,
              });

              const event = 'policy_enabled';

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('policy_fee_rate_updated', async policy => {
            try {
              const event = 'policy_fee_rate_updated';

              const {description} = await describeFeeRateUpdated({
                db,
                id: policy.id,
                local_keys: getKeys.map(n => n.public_key),
                previous: policy.previous,
                public_key: policy.public_key,
                updated: policy.updated,
              });

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('policy_max_htlc_mtokens_updated', async policy => {
            try {
              const event = 'policy_max_htlc_mtokens_updated';

              const {description} = await describeMaxHtlcUpdated({
                db,
                id: policy.id,
                local_keys: getKeys.map(n => n.public_key),
                previous: policy.previous,
                public_key: policy.public_key,
                updated: policy.updated,
              });

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('policy_min_htlc_mtokens_updated', async policy => {
            try {
              const event = 'policy_min_htlc_mtokens_updated';

              const {description} = await describeMinHtlcUpdated({
                db,
                id: policy.id,
                local_keys: getKeys.map(n => n.public_key),
                previous: policy.previous,
                public_key: policy.public_key,
                updated: policy.updated,
              });

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('received_htlc', async htlc => {
            try {
              const {description} = await describeHtlcReceived({
                db,
                in_channel: htlc.in_channel,
                public_key: htlc.public_key,
              });

              const event = 'received_htlc';

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('reconnected', async reconnect => {
            try {
              const event = 'reconnected';

              const {description} = await describePeerReconnected({
                db,
                node: reconnect.node,
                to: reconnect.to,
              });

              const {line} = logLineForChangeEvent({description, event, mode});

              return !!line ? logger.info(line) : null;
            } catch (err) {
              return logger.error({err});
            }
          });

          sub.on('rejected_payment', async rejection => {
            try {
              switch (rejection.internal_failure) {
              case 'UNKNOWN_INVOICE':
                {
                  const event = 'probe_received';

                  const {description} = await describeProbeReceived({
                    db,
                    in_channel: rejection.in_channel,
                    public_key: rejection.public_key,
                  });

                  const {line} = logLineForChangeEvent({
                    description,
                    event,
                    mode,
                  });

                  return !!line ? logger.info(line) : null;
                }

              default:
                {
                  const event = 'rejected_payment';

                  const {description} = await describePaymentRejected({
                    db,
                    in_channel: rejection.in_channel,
                    public_key: rejection.public_key,
                  });

                  const {line} = logLineForChangeEvent({
                    description,
                    event,
                    mode,
                  });

                  return !!line ? logger.info(line) : null;
                }
              }
            } catch (err) {
              return logger.error({err});
            }
          });

          return;
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
