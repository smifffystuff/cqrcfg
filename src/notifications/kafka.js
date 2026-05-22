import { Kafka, Partitioners } from 'kafkajs';
import { NotificationsInterface } from './interface.js';
import { logger } from '../logger.js';

export class KafkaNotifications extends NotificationsInterface {
  constructor(options) {
    super();
    this.brokers = options.brokers || ['localhost:9092'];
    this.topic = options.topic || 'cqrcfg-changes';
    this.clientId = options.clientId || 'cqrcfg';
    this.groupId = options.groupId || 'cqrcfg-group';

    this.kafka = null;
    this.producer = null;
    this.consumer = null;
    this.subscriptions = new Map(); // pathPrefix -> Set<callback>
    this.consumerRunning = false;
  }

  async connect() {
    this.kafka = new Kafka({
      clientId: this.clientId,
      brokers: this.brokers,
    });

    // Initialize producer
    this.producer = this.kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner,
    });
    await this.producer.connect();

    // Initialize consumer
    this.consumer = this.kafka.consumer({ groupId: this.groupId });
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.topic, fromBeginning: false });

    // Start consuming
    await this._startConsumer();

    logger.info({ brokers: this.brokers }, 'Kafka notifications connected');
  }

  async _startConsumer() {
    if (this.consumerRunning) return;
    this.consumerRunning = true;

    await this.consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const event = JSON.parse(message.value.toString());
          const path = event.path;

          // Dispatch to matching subscriptions
          for (const [prefix, callbacks] of this.subscriptions.entries()) {
            if (path === prefix || path.startsWith(prefix + '/')) {
              for (const callback of callbacks) {
                try {
                  callback(event);
                } catch (error) {
                  logger.error(error, 'Error in Kafka subscription callback');
                }
              }
            }
          }
        } catch (error) {
          logger.error(error, 'Error processing Kafka message');
        }
      },
    });
  }

  async close() {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }
    if (this.consumer) {
      await this.consumer.disconnect();
      this.consumer = null;
    }
    this.subscriptions.clear();
    this.consumerRunning = false;
    logger.info('Kafka notifications disconnected');
  }

  async publish(path, event) {
    if (!this.producer) {
      throw new Error('Kafka producer not connected');
    }

    await this.producer.send({
      topic: this.topic,
      messages: [
        {
          key: path,
          value: JSON.stringify(event),
        },
      ],
    });
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
