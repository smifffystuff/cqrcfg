import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyHttpProxy from '@fastify/http-proxy';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT, 10) || 80;
const HOST = process.env.HOST || '0.0.0.0';
const API_URL = process.env.API_URL || 'http://cqrcfg:3000';

function normalizeBasePath(raw) {
  if (!raw || raw === '/') return '';
  let bp = raw.trim();
  if (!bp.startsWith('/')) bp = '/' + bp;
  if (bp.endsWith('/')) bp = bp.slice(0, -1);
  return bp;
}

const BASE_PATH = normalizeBasePath(process.env.UI_BASE_PATH);

console.log('[cqrcfg-ui] startup config:', {
  UI_BASE_PATH_RAW: process.env.UI_BASE_PATH,
  BASE_PATH_NORMALIZED: BASE_PATH,
  API_URL,
  PORT,
  HOST,
});

const runtimeConfig = `window.__CQRCFG_BASE_PATH__ = '${BASE_PATH}';
window.__CQRCFG_ENV__ = '${process.env.UI_ENV || ''}';
window.__CQRCFG_API_URL__ = '${process.env.UI_API_URL || (BASE_PATH + '/api')}';
window.__CQRCFG_AUTH_HEADER__ = '${process.env.UI_AUTH_HEADER || ''}';
window.__CQRCFG_AUTH_PATTERN__ = '${process.env.UI_AUTH_PATTERN || ''}';
window.__CQRCFG_NAME_CLAIM__ = '${process.env.UI_NAME_CLAIM || 'sub'}';
window.__CQRCFG_USERNAME_CLAIM__ = '${process.env.UI_USERNAME_CLAIM || 'sub'}';
`;

// Rewrite index.html at startup to fix the config.js absolute path
// (Vite's base:'./' makes asset/theme/favicon refs relative, but non-module scripts stay absolute)
const rawHtml = readFileSync(join(__dirname, 'dist', 'index.html'), 'utf-8');
console.log('[cqrcfg-ui] raw dist/index.html (first 500 chars):', rawHtml.slice(0, 500));

const rewrittenHtml = rawHtml
  .replace(/src="\/config\.js"/g, `src="${BASE_PATH}/config.js"`);

console.log('[cqrcfg-ui] rewritten index.html (first 500 chars):', rewrittenHtml.slice(0, 500));

const fastify = Fastify({
  logger: true,
});

// Serve runtime config.js dynamically
fastify.get(`${BASE_PATH}/config.js`, async (request, reply) => {
  reply
    .header('Content-Type', 'application/javascript')
    .header('Cache-Control', 'no-cache, no-store')
    .send(runtimeConfig);
});

// API proxy
await fastify.register(fastifyHttpProxy, {
  upstream: API_URL,
  prefix: `${BASE_PATH}/api`,
  rewritePrefix: '',
  websocket: true,
});

// WebSocket proxy
await fastify.register(fastifyHttpProxy, {
  upstream: API_URL,
  prefix: `${BASE_PATH}/ws`,
  rewritePrefix: '',
  websocket: true,
});

// Serve the rewritten index.html for the base path root
fastify.get(`${BASE_PATH}/`, async (request, reply) => {
  console.log('[cqrcfg-ui] serving rewritten index.html for:', request.url);
  reply.header('Content-Type', 'text/html').send(rewrittenHtml);
});

// Serve static files (excluding index.html which is handled above)
await fastify.register(fastifyStatic, {
  root: join(__dirname, 'dist'),
  prefix: `${BASE_PATH}/`,
  index: false,
});

// Redirect bare base path (no trailing slash) to base path with slash
if (BASE_PATH) {
  fastify.get(BASE_PATH, async (request, reply) => {
    reply.redirect(`${BASE_PATH}/`);
  });
}

// SPA fallback - serve index.html for unmatched routes
fastify.setNotFoundHandler(async (request, reply) => {
  console.log('[cqrcfg-ui] 404 fallback hit for:', request.url);
  if (request.url.startsWith(`${BASE_PATH}/api/`) || request.url.startsWith(`${BASE_PATH}/ws/`)) {
    reply.code(404).send({ error: 'Not Found' });
    return;
  }
  reply.header('Content-Type', 'text/html').send(rewrittenHtml);
});

// Start server
try {
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`UI server listening on http://${HOST}:${PORT}${BASE_PATH}/`);
  console.log(`API proxy: ${API_URL}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
