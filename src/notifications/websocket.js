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
    // Find all subscriptions that match this path
    for (const [prefix, callbacks] of this.subscriptions.entries()) {
      if (path === prefix || path.startsWith(prefix + '/')) {
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

    return {
      unsubscribe: () => {
        const callbacks = this.subscriptions.get(pathPrefix);
        if (callbacks) {
          callbacks.delete(callback);
          if (callbacks.size === 0) {
            this.subscriptions.delete(pathPrefix);
          }
        }
      },
    };
  }

  supportsSubscription() {
    return true;
  }
}
