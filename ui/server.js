import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyHttpProxy from '@fastify/http-proxy';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT, 10) || 80;
const HOST = process.env.HOST || '0.0.0.0';
const API_URL = process.env.API_URL || 'http://cqrcfg:3000';

// Runtime config from environment
const runtimeConfig = `window.__CQRCFG_ENV__ = '${process.env.UI_ENV || ''}';
window.__CQRCFG_API_URL__ = '${process.env.UI_API_URL || '/api'}';
window.__CQRCFG_AUTH_HEADER__ = '${process.env.UI_AUTH_HEADER || ''}';
window.__CQRCFG_AUTH_PATTERN__ = '${process.env.UI_AUTH_PATTERN || ''}';
window.__CQRCFG_NAME_CLAIM__ = '${process.env.UI_NAME_CLAIM || 'sub'}';
window.__CQRCFG_USERNAME_CLAIM__ = '${process.env.UI_USERNAME_CLAIM || 'sub'}';
window.__CQRCFG_ACL_CLAIM__ = '${process.env.UI_ACL_CLAIM || 'cqrcfg_acl'}';
window.__CQRCFG_ACL_CACHE_TTL__ = ${process.env.UI_ACL_CACHE_TTL || 300};
`;

const fastify = Fastify({
  logger: true,
});

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  reply.send({ status: 'ok' });
});

// Serve runtime config.js dynamically
fastify.get('/config.js', async (request, reply) => {
  reply
    .header('Content-Type', 'application/javascript')
    .header('Cache-Control', 'no-cache, no-store')
    .send(runtimeConfig);
});

// API proxy
await fastify.register(fastifyHttpProxy, {
  upstream: API_URL,
  prefix: '/api',
  rewritePrefix: '',
  websocket: true,
});

// WebSocket proxy
await fastify.register(fastifyHttpProxy, {
  upstream: API_URL,
  prefix: '/ws',
  rewritePrefix: '',
  websocket: true,
});

// Serve static files
await fastify.register(fastifyStatic, {
  root: join(__dirname, 'dist'),
  prefix: '/',
});

// SPA fallback - serve index.html for unmatched routes
fastify.setNotFoundHandler(async (request, reply) => {
  // Don't serve index.html for API routes
  if (request.url.startsWith('/api/') || request.url.startsWith('/ws/')) {
    reply.code(404).send({ error: 'Not Found' });
    return;
  }
  return reply.sendFile('index.html');
});

// Start server
try {
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`UI server listening on http://${HOST}:${PORT}`);
  console.log(`API proxy: ${API_URL}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
