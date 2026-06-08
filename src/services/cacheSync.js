import { invalidateCacheForPath } from './configService.js';
import { subscribeToChanges, getInstanceId } from './notificationService.js';
import { logger } from '../logger.js';

let subscription = null;

export async function initCacheSync() {
  const localInstanceId = getInstanceId();

  subscription = await subscribeToChanges('/config', (event) => {
    // Skip events from this instance — we already invalidated locally during the write
    if (event.instanceId === localInstanceId) return;

    logger.debug({ path: event.path, from: event.instanceId }, 'Cross-instance cache invalidation');
    invalidateCacheForPath(event.path);
  });

  logger.info({ instanceId: localInstanceId }, 'Cross-instance cache sync initialized');
}

export async function closeCacheSync() {
  if (subscription) {
    subscription.unsubscribe();
    subscription = null;
  }
}
