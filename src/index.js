import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { config, validateConfig } from './config.js';
import { logger, loggerConfig } from './logger.js';
import { initStorage, closeStorage } from './storage/index.js';
import { initNotifications, closeNotifications } from './notifications/index.js';
import configRoutes from './routes/config.js';
import streamRoutes from './routes/stream.js';

async function main() {
  // Validate configuration
  validateConfig();

  // Initialize storage and notifications
  await initStorage();
  await initNotifications();

  // Create Fastify instance
  const fastify = Fastify({
    logger: loggerConfig,
    bodyLimit: 1048576, // 1MB
  });

  // Register WebSocket plugin
  await fastify.register(websocket);

  // Log all requests when Host matches the Kafka ingress
  fastify.addHook('onRequest', async (request) => {
    if (request.headers.host === 'kafka.streamproc.contentmgmt.int.pib.dowjones.io' || request.headers.host === 'streamproc-cqrcfg.djin-contentmgmt.svc.cluster.local:3000') {
      request.log.debug({ host: request.headers.host, headers: request.headers }, `incoming request: ${request.method} ${request.url}`);
    }
  });

  // Health check endpoint (no auth required)
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      storage: config.storage.type,
      notifications: config.notifications.type,
      timestamp: new Date().toISOString(),
    };
  });

  // Mount config routes
  await fastify.register(configRoutes, { prefix: '/config' });

  // Mount WebSocket stream routes
  await fastify.register(streamRoutes);

  // Error handler
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error(error, 'Unhandled error');

    if (error.validation) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Invalid request',
      });
    }

    if (error.statusCode === 400 && error.message.includes('JSON')) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Invalid JSON in request body',
      });
    }

    reply.code(500).send({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
  });

  // 404 handler
  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: 'Not Found',
      message: `Cannot ${request.method} ${request.url}`,
    });
  });

  // Start server
  await fastify.listen({
    port: config.server.port,
    host: config.server.host,
  });

  logger.info({ port: config.server.port, host: config.server.host, storage: config.storage.type, notifications: config.notifications.type, logLevel: config.logLevel }, 'Config service started');

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Shutting down gracefully');

    await fastify.close();
    await closeNotifications();
    await closeStorage();
    logger.info('Server closed - flushing logs and exiting');

    // Allow async transport worker to drain buffered messages
    setTimeout(() => process.exit(0), 200);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal(error, 'Failed to start server');
  process.exit(1);
});
