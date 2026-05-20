import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { config, validateConfig } from './config.js';
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
    logger: config.logLevel === 'debug',
    bodyLimit: 1048576, // 1MB
  });

  // Register WebSocket plugin
  await fastify.register(websocket);

  // Log all requests when Host matches the Kafka ingress
  fastify.addHook('onRequest', async (request) => {
    if (request.headers.host === 'kafka.streamproc.contentmgmt.int.pib.dowjones.io' || request.headers.host === 'streamproc-cqrcfg.djin-contentmgmt.svc.cluster.local:3000') {
      console.log(`[cqrcfg] incoming request: ${request.method} ${request.url}, from ${request.headers.host}`);
      console.log('[cqrcfg] headers:', JSON.stringify(request.headers, null, 2));
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
    console.error('Unhandled error:', error);

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

  console.log(`Config service running at http://${config.server.host}:${config.server.port}`);
  console.log(`Storage: ${config.storage.type}`);
  console.log(`Notifications: ${config.notifications.type}`);
  console.log('Endpoints:');
  console.log('  GET    /health        - Health check');
  console.log('  GET    /config/*      - Get config subtree');
  console.log('  POST   /config/*      - Merge config (preserves missing values)');
  console.log('  PUT    /config/*      - Replace config (overwrites all values)');
  console.log('  DELETE /config/*      - Delete config subtree');
  console.log('  (POST/PUT support ?from=... to copy from another path)');
  console.log('  WS     /stream/*      - Subscribe to changes');

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);

    await fastify.close();
    await closeNotifications();
    await closeStorage();
    console.log('Server closed');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
