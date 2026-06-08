import { NotificationsInterface } from './interface.js';
import { logger } from '../logger.js';

/**
 * WebSocket notifications - manages in-process subscriptions for WebSocket clients.
 * This is the default that works without external dependencies.
 */
export class WebSocketNotifications extends NotificationsInterface {
  constructor() {
    super();
    this.subscriptions = new Map(); // pathPrefix -> Set<callback>
  }

  async connect() {
    logger.info('WebSocket notifications initialized');
  }

  async close() {
    this.subscriptions.clear();
    logger.info('WebSocket notifications closed');
  }

  async publish(path, event) {
    logger.debug('[SOCKET] Publishing event for path=%s op=%s (%d active subscriptions)', path, event.operation, this.subscriptions.size);
    // Find all subscriptions that match this path
    for (const [prefix, callbacks] of this.subscriptions.entries()) {
      if (path === prefix || path.startsWith(prefix + '/')) {
        logger.debug('[SOCKET] Matched subscription prefix=%s (%d callbacks)', prefix, callbacks.size);
        for (const callback of callbacks) {
          try {
            callback(event);
          } catch (error) {
            logger.error(error, 'Error in subscription callback');
          }
        }
      }
    }
  }

  async subscribe(pathPrefix, callback) {
    if (!this.subscriptions.has(pathPrefix)) {
      this.subscriptions.set(pathPrefix, new Set());
    }
    this.subscriptions.get(pathPrefix).add(callback);
    logger.debug('[SOCKET] New subscription for prefix=%s (total subscriptions: %d)', pathPrefix, this.subscriptions.size);

    return {
      unsubscribe: () => {
        const callbacks = this.subscriptions.get(pathPrefix);
        if (callbacks) {
          callbacks.delete(callback);
          if (callbacks.size === 0) {
            this.subscriptions.delete(pathPrefix);
          }
        }
        logger.debug('[SOCKET] Unsubscribed from prefix=%s (total subscriptions: %d)', pathPrefix, this.subscriptions.size);
      },
    };
  }

  supportsSubscription() {
    return true;
  }
}
