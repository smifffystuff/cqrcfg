import { invalidateCacheForPath } from './configService.js';
import { subscribeToChanges, getInstanceId } from './notificationService.js';
import { logger } from '../logger.js';

let subscription = null;
let localChangeListeners = new Set();

export function onLocalChange(callback) {
  localChangeListeners.add(callback);
  return () => localChangeListeners.delete(callback);
}

export async function initCacheSync() {
  const localInstanceId = getInstanceId();

  subscription = await subscribeToChanges('/config', (event) => {
    // Skip events from this instance — we already invalidated locally during the write
    if (event.instanceId === localInstanceId) return;

    logger.debug({ path: event.path, from: event.instanceId }, 'Cross-instance cache invalidation');
    invalidateCacheForPath(event.path);

    // Notify local WebSocket clients about the remote change
    for (const listener of localChangeListeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error(err, 'Error in local change listener');
      }
    }
  });

  logger.info({ instanceId: localInstanceId }, 'Cross-instance cache sync initialized');
}

export async function closeCacheSync() {
  if (subscription) {
    subscription.unsubscribe();
    subscription = null;
  }
}
