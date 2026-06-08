import { randomBytes } from 'crypto';
import { hostname } from 'os';
import { getNotificationBroker } from '../notifications/index.js';

const instanceId = `${hostname()}-${randomBytes(4).toString('hex')}`;

export function getInstanceId() {
  return instanceId;
}

/**
 * Publish a config change notification
 * @param {string} operation - 'insert', 'update', or 'delete'
 * @param {string} path - The config path that changed
 * @param {Object} [data] - The new data (not present for deletes)
 * @param {string} [revision] - The git commit hash after the change
 */
export async function notifyChange(operation, path, data = null, revision = null) {
  const broker = getNotificationBroker();

  const event = {
    operation,
    path,
    timestamp: new Date().toISOString(),
    instanceId,
  };

  if (data !== null) {
    event.data = data;
  }

  if (revision) {
    event.revision = revision;
  }

  await broker.publish(path, event);
}

/**
 * Subscribe to config changes for a path prefix
 * @param {string} pathPrefix - The path prefix to subscribe to
 * @param {function(Object): void} callback - Called when events arrive
 * @returns {Object} Subscription handle with unsubscribe() method
 */
export async function subscribeToChanges(pathPrefix, callback) {
  const broker = getNotificationBroker();
  return broker.subscribe(pathPrefix, callback);
}

/**
 * Check if the broker supports subscriptions
 */
export function supportsSubscription() {
  const broker = getNotificationBroker();
  return broker.supportsSubscription();
}
