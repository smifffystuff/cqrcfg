import amqp from 'amqplib';
import { NotificationsInterface } from './interface.js';
import { logger } from '../logger.js';

export class AMQPNotifications extends NotificationsInterface {
  constructor(options) {
    super();
    this.url = options.url || 'amqp://localhost';
    this.exchange = options.exchange || 'cqrcfg';
    this.exchangeType = options.exchangeType || 'topic';

    this.connection = null;
    this.channel = null;
    this.subscriptions = new Map(); // pathPrefix -> { queue, consumerTag, callbacks }
  }

  async connect() {
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createChannel();

    // Declare the exchange
    await this.channel.assertExchange(this.exchange, this.exchangeType, {
      durable: true,
    });

    // Handle connection errors
    this.connection.on('error', (error) => {
      logger.error(error, 'AMQP connection error');
    });

    this.connection.on('close', () => {
      logger.info('AMQP connection closed');
    });

    logger.info({ url: this.url }, 'AMQP notifications connected');
  }

  async close() {
    // Cancel all consumers
    for (const [, sub] of this.subscriptions.entries()) {
      if (sub.consumerTag) {
        try {
          await this.channel.cancel(sub.consumerTag);
        } catch {
          // Ignore errors during cleanup
        }
      }
    }
    this.subscriptions.clear();

    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
    logger.info('AMQP notifications disconnected');
  }

  _pathToRoutingKey(path) {
    // Convert path to AMQP routing key
    // /config/app1/db -> config.app1.db
    return path.replace(/^\//, '').replace(/\//g, '.');
  }

  _routingKeyToPath(routingKey) {
    // Convert routing key back to path
    // config.app1.db -> /config/app1/db
    return '/' + routingKey.replace(/\./g, '/');
  }

  _prefixToPattern(pathPrefix) {
    // Convert path prefix to AMQP binding pattern
    // /config/app1 -> config.app1.#
    const key = this._pathToRoutingKey(pathPrefix);
    return key + '.#';
  }

  async publish(path, event) {
    if (!this.channel) {
      throw new Error('AMQP channel not connected');
    }

    const routingKey = this._pathToRoutingKey(path);
    const message = Buffer.from(JSON.stringify(event));

    this.channel.publish(this.exchange, routingKey, message, {
      persistent: true,
      contentType: 'application/json',
    });
  }

  async subscribe(pathPrefix, callback) {
    if (!this.channel) {
      throw new Error('AMQP channel not connected');
    }

    // Check if we already have a subscription for this prefix
    let sub = this.subscriptions.get(pathPrefix);

    if (!sub) {
      // Create a new queue for this subscription
      const { queue } = await this.channel.assertQueue('', {
        exclusive: true,
        autoDelete: true,
      });

      // Bind to the exchange with the path pattern
      const pattern = this._prefixToPattern(pathPrefix);
      await this.channel.bindQueue(queue, this.exchange, pattern);

      // Also bind to exact match (for the prefix path itself)
      const exactKey = this._pathToRoutingKey(pathPrefix);
      await this.channel.bindQueue(queue, this.exchange, exactKey);

      sub = {
        queue,
        consumerTag: null,
        callbacks: new Set(),
      };

      // Start consuming
      const { consumerTag } = await this.channel.consume(queue, (msg) => {
        if (msg) {
          try {
            const event = JSON.parse(msg.content.toString());
            for (const cb of sub.callbacks) {
              try {
                cb(event);
              } catch (error) {
                logger.error(error, 'Error in AMQP subscription callback');
              }
            }
            this.channel.ack(msg);
          } catch (error) {
            logger.error(error, 'Error processing AMQP message');
            this.channel.nack(msg, false, false);
          }
        }
      });

      sub.consumerTag = consumerTag;
      this.subscriptions.set(pathPrefix, sub);
    }

    sub.callbacks.add(callback);

    return {
      unsubscribe: async () => {
        sub.callbacks.delete(callback);
        if (sub.callbacks.size === 0) {
          // No more callbacks, cancel consumer and delete queue
          if (sub.consumerTag) {
            await this.channel.cancel(sub.consumerTag);
          }
          this.subscriptions.delete(pathPrefix);
        }
      },
    };
  }

  supportsSubscription() {
    return true;
  }
}
