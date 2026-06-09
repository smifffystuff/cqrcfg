import { invalidateCacheForPath } from './configService.js';
import { subscribeToChanges, getInstanceId } from './notificationService.js';
import { getStorage } from '../storage/index.js';
import { logger } from '../logger.js';

let subscription = null;

export async function initCacheSync() {
  const localInstanceId = getInstanceId();

  subscription = await subscribeToChanges('/config', async (event) => {
    if (event.instanceId === localInstanceId) return;

    logger.debug({ path: event.path, from: event.instanceId }, 'Cross-instance sync');
    invalidateCacheForPath(event.path);

    try {
      await getStorage().sync();
    } catch (err) {
      logger.error({ err: err.message }, 'Storage sync failed after change notification');
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
