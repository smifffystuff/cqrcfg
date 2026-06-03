import { config } from '../config.js';
import { WebSocketNotifications } from './websocket.js';
import { KafkaNotifications } from './kafka.js';
import { AMQPNotifications } from './amqp.js';

let broker = null;

export function createNotificationBroker() {
  const notificationType = config.notifications.type;

  switch (notificationType) {
    case 'websocket':
      return new WebSocketNotifications();

    case 'kafka':
      return new KafkaNotifications({
        brokers: config.notifications.kafka.brokers,
        topic: config.notifications.kafka.topic,
        clientId: config.notifications.kafka.clientId,
        groupId: config.notifications.kafka.groupId,
        ssl: config.notifications.kafka.ssl,
        sasl: config.notifications.kafka.sasl,
      });

    case 'amqp':
      return new AMQPNotifications({
        url: config.notifications.amqp.url,
        exchange: config.notifications.amqp.exchange,
        exchangeType: config.notifications.amqp.exchangeType,
      });

    default:
      throw new Error(`Unknown notifications type: ${notificationType}`);
  }
}

export async function initNotifications() {
  broker = createNotificationBroker();
  await broker.connect();
  return broker;
}

export function getNotificationBroker() {
  if (!broker) {
    throw new Error('Notifications not initialized. Call initNotifications() first.');
  }
  return broker;
}

export async function closeNotifications() {
  if (broker) {
    await broker.close();
    broker = null;
  }
}
