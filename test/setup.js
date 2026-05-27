import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import Fastify from 'fastify';

// Generate RSA key pair for test JWT signing
let privateKey;
let publicKey;
let jwks;

export async function initTestKeys() {
  if (privateKey) return { privateKey, publicKey, jwks };

  const keyPair = await generateKeyPair('RS256');
  privateKey = keyPair.privateKey;
  publicKey = keyPair.publicKey;

  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-key-1';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  jwks = { keys: [publicJwk] };

  return { privateKey, publicKey, jwks };
}

export async function createTestToken(claims = {}, options = {}) {
  const { privateKey } = await initTestKeys();

  const defaultClaims = {
    sub: 'test-user',
    authz_rules: [
      { path: '/config', allow: ['read', 'write'] },
    ],
  };

  const mergedClaims = { ...defaultClaims, ...claims };

  const jwt = await new SignJWT(mergedClaims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuedAt()
    .setExpirationTime(options.expiresIn || '1h')
    .sign(privateKey);

  return jwt;
}

// Start a mock JWKS server
let jwksServer;
let jwksServerUrl;

export async function startJwksServer(port = 0) {
  // If server already running, return existing URL
  if (jwksServer && jwksServerUrl) {
    return jwksServerUrl;
  }

  const { jwks } = await initTestKeys();

  jwksServer = Fastify();

  jwksServer.get('/.well-known/jwks.json', async () => {
    return jwks;
  });

  // Use port 0 for random available port
  await jwksServer.listen({ port, host: '127.0.0.1' });
  const address = jwksServer.server.address();
  jwksServerUrl = `http://127.0.0.1:${address.port}/.well-known/jwks.json`;
  return jwksServerUrl;
}

export async function stopJwksServer() {
  if (jwksServer) {
    await jwksServer.close();
    jwksServer = null;
    jwksServerUrl = null;
  }
}

// Wait for service to be ready
export async function waitForService(url, maxRetries = 30, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // Service not ready yet
    }
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error(`Service at ${url} not ready after ${maxRetries} retries`);
}

// Wait for MongoDB to be ready
export async function waitForMongo(uri, maxRetries = 30) {
  const { MongoClient } = await import('mongodb');

  for (let i = 0; i < maxRetries; i++) {
    try {
      const client = new MongoClient(uri);
      await client.connect();
      await client.db().admin().ping();
      await client.close();
      return true;
    } catch {
      // MongoDB not ready yet
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`MongoDB at ${uri} not ready after ${maxRetries} retries`);
}

// Wait for Kafka to be ready
export async function waitForKafka(brokers, maxRetries = 30) {
  const { Kafka } = await import('kafkajs');

  for (let i = 0; i < maxRetries; i++) {
    try {
      const kafka = new Kafka({
        clientId: 'test-wait',
        brokers,
      });
      const admin = kafka.admin();
      await admin.connect();
      await admin.listTopics();
      await admin.disconnect();
      return true;
    } catch {
      // Kafka not ready yet
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Kafka at ${brokers.join(',')} not ready after ${maxRetries} retries`);
}

// Clean up MongoDB test data
export async function cleanupMongo(uri, database) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri);
  await client.connect();
  await client.db(database).dropDatabase();
  await client.close();
}
