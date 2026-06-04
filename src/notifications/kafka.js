import { readFileSync } from 'fs';
import { Kafka, Partitioners } from 'kafkajs';
import { NotificationsInterface } from './interface.js';
import { logger } from '../logger.js';

function buildSslConfig(ssl) {
  if (!ssl || !ssl.enabled) return undefined;
  const cfg = { rejectUnauthorized: ssl.rejectUnauthorized };
  if (ssl.ca) cfg.ca = [readFileSync(ssl.ca, 'utf8')];
  if (ssl.key) cfg.key = readFileSync(ssl.key, 'utf8');
  if (ssl.cert) cfg.cert = readFileSync(ssl.cert, 'utf8');
  return cfg;
}

function buildSaslConfig(sasl) {
  if (!sasl || !sasl.mechanism) return undefined;
  const mechanism = sasl.mechanism.toLowerCase();

  if (mechanism === 'plain' || mechanism === 'scram-sha-256' || mechanism === 'scram-sha-512') {
    return { mechanism, username: sasl.username, password: sasl.password };
  }

  if (mechanism === 'oauthbearer') {
    const { clientId, clientSecret, tokenUri } = sasl;
    return {
      mechanism: 'oauthbearer',
      oauthBearerProvider: async () => {
        const body = new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        });
        const res = await fetch(tokenUri, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        if (!res.ok) {
          throw new Error(`OAuth token request failed: ${res.status} ${res.statusText}`);
        }
        const data = await res.json();
        return { value: data.access_token };
      },
    };
  }

  throw new Error(`Unsupported KAFKA_SASL_MECHANISM: ${sasl.mechanism}`);
}

export class KafkaNotifications extends NotificationsInterface {
  constructor(options) {
    super();
    this.brokers = options.brokers || ['localhost:9092'];
    this.topic = options.topic || 'cqrcfg-changes';
    this.clientId = options.clientId || 'cqrcfg';
    this.groupId = options.groupId || 'cqrcfg-group';
    this.sslConfig = buildSslConfig(options.ssl);
    this.saslConfig = buildSaslConfig(options.sasl);

    this.kafka = null;
    this.producer = null;
    this.consumer = null;
    this.subscriptions = new Map(); // pathPrefix -> Set<callback>
    this.consumerRunning = false;
  }

  async connect() {
    const kafkaConfig = {
      clientId: this.clientId,
      brokers: this.brokers,
    };
    if (this.sslConfig) kafkaConfig.ssl = this.sslConfig;
    if (this.saslConfig) kafkaConfig.sasl = this.saslConfig;

    this.kafka = new Kafka(kafkaConfig);

    await this._ensureTopicExists();

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

  async _ensureTopicExists() {
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      const topics = await admin.listTopics();
      if (topics.includes(this.topic)) return;

      logger.info({ topic: this.topic }, 'Kafka topic does not exist, creating');
      await admin.createTopics({
        waitForLeaders: true,
        topics: [{ topic: this.topic }],
      });

      // Allow metadata to propagate across brokers
      const maxAttempts = 5;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const metadata = await admin.fetchTopicMetadata({ topics: [this.topic] }).catch(() => null);
        if (metadata?.topics?.[0]?.partitions?.length > 0) {
          logger.info({ topic: this.topic }, 'Kafka topic created');
          return;
        }
      }
      logger.warn({ topic: this.topic }, 'Kafka topic created but metadata propagation may be incomplete');
    } finally {
      await admin.disconnect();
    }
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
