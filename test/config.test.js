import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { initTestKeys, createTestToken, startJwksServer, stopJwksServer, cleanupMongo } from './setup.js';

// Set environment before importing app modules
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DATABASE = 'cqrcfg_test';

process.env.STORAGE_TYPE = 'mongodb';
process.env.MONGODB_URI = MONGO_URI;
process.env.MONGODB_DATABASE = DATABASE;
process.env.NOTIFICATIONS_TYPE = 'websocket';

let jwksUri;

describe('Config API', async () => {
  let fastify;
  let token;

  before(async () => {
    // Start JWKS server (uses random available port)
    jwksUri = await startJwksServer();
    process.env.OIDC_JWKS_URIS = jwksUri;

    // Import modules after setting env
    const { initStorage, closeStorage } = await import('../src/storage/index.js');
    const { initNotifications, closeNotifications } = await import('../src/notifications/index.js');
    const configRoutes = (await import('../src/routes/config.js')).default;

    // Initialize
    await initStorage();
    await initNotifications();

    // Create Fastify instance
    fastify = Fastify({ logger: false });
    await fastify.register(websocket);
    await fastify.register(configRoutes, { prefix: '/config' });

    // Create test token
    token = await createTestToken({
      sub: 'test-user',
      cqrcfg_acl: [
        { path: '/config', allow: ['read', 'write'] },
      ],
    });
  });

  after(async () => {
    await fastify.close();
    await stopJwksServer();

    const { closeStorage } = await import('../src/storage/index.js');
    const { closeNotifications } = await import('../src/notifications/index.js');
    await closeNotifications();
    await closeStorage();
  });

  beforeEach(async () => {
    await cleanupMongo(MONGO_URI, DATABASE);
  });

  it('should return 401 without auth token', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/config/app1',
    });

    assert.strictEqual(response.statusCode, 401);
  });

  it('should return 404 for non-existent path', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/config/nonexistent',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.statusCode, 404);
  });

  it('should create and retrieve config with PUT', async () => {
    const data = { host: 'localhost', port: 5432 };

    // Create
    const putResponse = await fastify.inject({
      method: 'PUT',
      url: '/config/app1/db',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      payload: data,
    });

    assert.strictEqual(putResponse.statusCode, 200);
    const putBody = JSON.parse(putResponse.body);
    assert.deepStrictEqual(putBody.data, data);

    // Retrieve
    const getResponse = await fastify.inject({
      method: 'GET',
      url: '/config/app1/db',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.strictEqual(getResponse.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(getResponse.body), data);
  });

  it('should merge config with PATCH', async () => {
    // Create initial
    await fastify.inject({
      method: 'PUT',
      url: '/config/app1/db',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      payload: { host: 'localhost', port: 5432 },
    });

    // Patch
    const patchResponse = await fastify.inject({
      method: 'PATCH',
      url: '/config/app1/db',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      payload: { port: 5433, ssl: true },
    });

    assert.strictEqual(patchResponse.statusCode, 200);

    // Verify merge
    const getResponse = await fastify.inject({
      method: 'GET',
      url: '/config/app1/db',
      headers: { Authorization: `Bearer ${token}` },
    });

    const result = JSON.parse(getResponse.body);
    assert.strictEqual(result.host, 'localhost');
    assert.strictEqual(result.port, 5433);
    assert.strictEqual(result.ssl, true);
  });

  it('should delete config subtree', async () => {
    // Create
    await fastify.inject({
      method: 'PUT',
      url: '/config/app1/db',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      payload: { host: 'localhost' },
    });

    // Delete
    const deleteResponse = await fastify.inject({
      method: 'DELETE',
      url: '/config/app1/db',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.strictEqual(deleteResponse.statusCode, 200);

    // Verify deletion
    const getResponse = await fastify.inject({
      method: 'GET',
      url: '/config/app1/db',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.strictEqual(getResponse.statusCode, 404);
  });

  it('should return subtree for parent path', async () => {
    // Create nested data
    await fastify.inject({
      method: 'PUT',
      url: '/config/app1/db',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      payload: { host: 'db.local' },
    });

    await fastify.inject({
      method: 'PUT',
      url: '/config/app1/cache',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      payload: { host: 'cache.local' },
    });

    // Get parent path
    const response = await fastify.inject({
      method: 'GET',
      url: '/config/app1',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.statusCode, 200);
    const tree = JSON.parse(response.body);
    assert.strictEqual(tree.db.host, 'db.local');
    assert.strictEqual(tree.cache.host, 'cache.local');
  });

  it('should reject invalid JSON body', async () => {
    const response = await fastify.inject({
      method: 'PUT',
      url: '/config/app1/db',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      payload: 'not valid json',
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it('should reject array body', async () => {
    const response = await fastify.inject({
      method: 'PUT',
      url: '/config/app1/db',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      payload: [1, 2, 3],
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it('should list paths with trailing slash', async () => {
    // Create test data with list permission
    const listToken = await createTestToken({
      sub: 'list-user',
      cqrcfg_acl: [
        { path: '/config', allow: ['read', 'write', 'list'] },
      ],
    });

    // Create some configs
    await fastify.inject({
      method: 'PUT',
      url: '/config/app1/db',
      headers: {
        Authorization: `Bearer ${listToken}`,
        'Content-Type': 'application/json',
      },
      payload: { host: 'localhost' },
    });

    await fastify.inject({
      method: 'PUT',
      url: '/config/app1/cache',
      headers: {
        Authorization: `Bearer ${listToken}`,
        'Content-Type': 'application/json',
      },
      payload: { host: 'redis' },
    });

    // List with trailing slash
    const response = await fastify.inject({
      method: 'GET',
      url: '/config/app1/',
      headers: { Authorization: `Bearer ${listToken}` },
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body.keys));
    assert.ok(body.keys.includes('/config/app1/db'));
    assert.ok(body.keys.includes('/config/app1/cache'));
  });

  it('should deny list without list permission', async () => {
    // Token with only read/write, no list
    const noListToken = await createTestToken({
      sub: 'no-list-user',
      cqrcfg_acl: [
        { path: '/config', allow: ['read', 'write'] },
      ],
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/config/app1/',
      headers: { Authorization: `Bearer ${noListToken}` },
    });

    assert.strictEqual(response.statusCode, 403);
  });

  it('should return 404 for list on empty path', async () => {
    const listToken = await createTestToken({
      sub: 'list-user',
      cqrcfg_acl: [
        { path: '/config', allow: ['list'] },
      ],
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/config/nonexistent/',
      headers: { Authorization: `Bearer ${listToken}` },
    });

    assert.strictEqual(response.statusCode, 404);
  });

  it('should search paths with wildcards', async () => {
    const listToken = await createTestToken({
      sub: 'list-user',
      cqrcfg_acl: [
        { path: '/config', allow: ['read', 'write', 'list'] },
      ],
    });

    // Create multiple configs
    await fastify.inject({
      method: 'PUT',
      url: '/config/app1/db',
      headers: { Authorization: `Bearer ${listToken}`, 'Content-Type': 'application/json' },
      payload: { host: 'db1' },
    });
    await fastify.inject({
      method: 'PUT',
      url: '/config/app2/db',
      headers: { Authorization: `Bearer ${listToken}`, 'Content-Type': 'application/json' },
      payload: { host: 'db2' },
    });
    await fastify.inject({
      method: 'PUT',
      url: '/config/app1/cache',
      headers: { Authorization: `Bearer ${listToken}`, 'Content-Type': 'application/json' },
      payload: { host: 'cache1' },
    });

    // Search with wildcard - find all db configs
    const response = await fastify.inject({
      method: 'GET',
      url: '/config/*/db/',
      headers: { Authorization: `Bearer ${listToken}` },
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body.keys));
    assert.ok(body.keys.includes('/config/app1/db'));
    assert.ok(body.keys.includes('/config/app2/db'));
    assert.ok(!body.keys.includes('/config/app1/cache'));
  });

  it('should search paths with ** wildcard', async () => {
    const listToken = await createTestToken({
      sub: 'list-user',
      cqrcfg_acl: [
        { path: '/config', allow: ['read', 'write', 'list'] },
      ],
    });

    // Create nested configs
    await fastify.inject({
      method: 'PUT',
      url: '/config/team1/app1/db',
      headers: { Authorization: `Bearer ${listToken}`, 'Content-Type': 'application/json' },
      payload: { host: 'db1' },
    });
    await fastify.inject({
      method: 'PUT',
      url: '/config/team2/app1/db',
      headers: { Authorization: `Bearer ${listToken}`, 'Content-Type': 'application/json' },
      payload: { host: 'db2' },
    });

    // Search with ** wildcard - find all db configs regardless of nesting
    const response = await fastify.inject({
      method: 'GET',
      url: '/config/**/db/',
      headers: { Authorization: `Bearer ${listToken}` },
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body.keys));
    assert.ok(body.keys.includes('/config/team1/app1/db'));
    assert.ok(body.keys.includes('/config/team2/app1/db'));
  });
});

describe('Authorization', async () => {
  let fastify;

  before(async () => {
    // Re-initialize storage and notifications (they were closed by Config API suite)
    const { initStorage } = await import('../src/storage/index.js');
    const { initNotifications } = await import('../src/notifications/index.js');
    await initStorage();
    await initNotifications();

    const configRoutes = (await import('../src/routes/config.js')).default;

    fastify = Fastify({ logger: false });
    await fastify.register(websocket);
    await fastify.register(configRoutes, { prefix: '/config' });
  });

  after(async () => {
    await fastify.close();
    const { closeStorage } = await import('../src/storage/index.js');
    const { closeNotifications } = await import('../src/notifications/index.js');
    await closeNotifications();
    await closeStorage();
  });

  beforeEach(async () => {
    await cleanupMongo(MONGO_URI, DATABASE);
  });

  it('should allow read with read permission', async () => {
    const readOnlyToken = await createTestToken({
      cqrcfg_acl: [
        { path: '/config/app1', allow: ['read'] },
      ],
    });

    // First create some data with a full-access token
    const fullToken = await createTestToken({
      cqrcfg_acl: [
        { path: '/config', allow: ['read', 'write'] },
      ],
    });

    await fastify.inject({
      method: 'PUT',
      url: '/config/app1/db',
      headers: {
        Authorization: `Bearer ${fullToken}`,
        'Content-Type': 'application/json',
      },
      payload: { host: 'localhost' },
    });

    // Read with read-only token
    const response = await fastify.inject({
      method: 'GET',
      url: '/config/app1/db',
      headers: { Authorization: `Bearer ${readOnlyToken}` },
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it('should deny write with read-only permission', async () => {
    const readOnlyToken = await createTestToken({
      cqrcfg_acl: [
        { path: '/config/app1', allow: ['read'] },
      ],
    });

    const response = await fastify.inject({
      method: 'PUT',
      url: '/config/app1/db',
      headers: {
        Authorization: `Bearer ${readOnlyToken}`,
        'Content-Type': 'application/json',
      },
      payload: { host: 'localhost' },
    });

    assert.strictEqual(response.statusCode, 403);
  });

  it('should deny access to unauthorized path', async () => {
    const token = await createTestToken({
      cqrcfg_acl: [
        { path: '/config/app1', allow: ['read', 'write'] },
      ],
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/config/app2',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.statusCode, 403);
  });

  it('should use boundary-safe prefix matching', async () => {
    const token = await createTestToken({
      cqrcfg_acl: [
        { path: '/config/app1', allow: ['read', 'write'] },
      ],
    });

    // /app1 should NOT grant access to /app10
    const response = await fastify.inject({
      method: 'GET',
      url: '/config/app10',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.strictEqual(response.statusCode, 403);
  });
});
