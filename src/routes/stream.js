import * as jose from 'jose';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { subscribeToChanges, supportsSubscription } from '../services/notificationService.js';

let jwks = null;

async function getJWKS() {
  if (jwks) return jwks;

  jwks = jose.createRemoteJWKSet(new URL(config.oidc.jwksUri));
  return jwks;
}

/**
 * Check if a string looks like a JWT (three base64url segments separated by dots)
 */
function isJwtFormat(value) {
  const parts = value.split('.');
  return parts.length === 3;
}

/**
 * Parse a header value as JSON (supports base64 or plain JSON)
 */
function parseJsonHeaderValue(headerValue) {
  if (!headerValue) return null;

  try {
    // Try base64 decode first (common for proxied claims)
    const decoded = Buffer.from(headerValue, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    // Try plain JSON
    try {
      return JSON.parse(headerValue);
    } catch {
      return null;
    }
  }
}

/**
 * Build JWT verify options based on config
 */
function getJwtVerifyOptions() {
  const options = {
    algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'],
  };

  if (config.oidc.audience) {
    options.audience = config.oidc.audience;
  }

  return options;
}

/**
 * Parse and verify a JWT header value, returning the payload claims
 */
async function parseJwtHeaderValue(headerValue, keySet) {
  if (!headerValue) return null;

  const { payload } = await jose.jwtVerify(headerValue, keySet, getJwtVerifyOptions());
  return payload;
}

/**
 * Parse a header value - auto-detects JWT vs JSON/base64 format
 * JWTs are verified using the JWKS, JSON values are parsed directly
 */
async function parseHeaderValue(headerValue, keySet) {
  if (!headerValue) return null;

  // Check if it looks like a JWT
  if (isJwtFormat(headerValue)) {
    return parseJwtHeaderValue(headerValue, keySet);
  }

  // Otherwise try JSON/base64
  return parseJsonHeaderValue(headerValue);
}

/**
 * Extract and merge claims from configured header chain.
 * Headers are processed in order, with later headers taking precedence.
 * JWT headers are verified, JSON/base64 headers are parsed directly.
 */
async function extractClaimsFromHeaders(headers, keySet) {
  const claimsHeaders = config.oidc.claimsHeaders;
  if (!claimsHeaders || claimsHeaders.length === 0) return null;

  let mergedClaims = null;

  for (const headerName of claimsHeaders) {
    const headerValue = headers[headerName.toLowerCase()];
    const claims = await parseHeaderValue(headerValue, keySet);

    if (claims) {
      if (mergedClaims === null) {
        mergedClaims = claims;
      } else {
        // Merge claims, later headers override earlier ones
        mergedClaims = { ...mergedClaims, ...claims };
      }
    }
  }

  return mergedClaims;
}

/**
 * Verify JWT token and extract user info
 */
async function verifyToken(token, headers) {
  const keySet = await getJWKS();
  const { payload } = await jose.jwtVerify(token, keySet, getJwtVerifyOptions());

  // Check for claims in separate headers (e.g., from a proxy that extracts id_token claims)
  // JWT-format headers are verified, JSON/base64 headers are parsed directly
  const externalClaims = await extractClaimsFromHeaders(headers, keySet);
  const claims = externalClaims || payload;

  return {
    sub: claims.sub || payload.sub,
    permissions: claims.cqrcfg_acl || [],
  };
}

/**
 * Check if user has read permission for a path
 */
function hasReadPermission(user, requestedPath) {
  return user.permissions.some((perm) => {
    if (perm.path === requestedPath) return perm.allow?.includes('read');
    if (requestedPath.startsWith(perm.path + '/')) return perm.allow?.includes('read');
    return false;
  });
}

/**
 * Normalize a path from the WebSocket URL
 */
function normalizePath(urlPath) {
  // URL path is like /stream/app1/db -> config path is /config/app1/db
  let path = urlPath.replace(/^\/stream\/?/, '');
  // Remove query string if present
  path = path.split('?')[0];
  path = path.replace(/^\/+|\/+$/g, '');
  path = path.replace(/\/+/g, '/');

  if (path.includes('..')) {
    throw new Error('Path traversal not allowed');
  }

  return path ? `/config/${path}` : '/config';
}

/**
 * Fastify WebSocket routes for change streams
 */
export default async function streamRoutes(fastify) {
  fastify.get('/stream/*', { websocket: true }, async (socket, request) => {
    let subscription = null;
    let user = null;

    try {
      // Check if subscriptions are supported
      if (!supportsSubscription()) {
        socket.send(JSON.stringify({
          type: 'error',
          message: 'Change notifications not supported by current broker',
        }));
        socket.close(1008, 'Subscriptions not supported');
        return;
      }

      // Extract token from query string or Authorization header
      const token = request.query.token ||
        request.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        socket.send(JSON.stringify({ type: 'error', message: 'Missing authentication token' }));
        socket.close(1008, 'Unauthorized');
        return;
      }

      // Verify token
      try {
        user = await verifyToken(token, request.headers);
      } catch (error) {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
        socket.close(1008, 'Unauthorized');
        return;
      }

      // Normalize and validate path
      let configPath;
      try {
        configPath = normalizePath(request.url);
      } catch (error) {
        socket.send(JSON.stringify({ type: 'error', message: error.message }));
        socket.close(1008, 'Bad Request');
        return;
      }

      // Check authorization
      if (!hasReadPermission(user, configPath)) {
        socket.send(JSON.stringify({
          type: 'error',
          message: `Access denied: no read permission for ${configPath}`,
        }));
        socket.close(1008, 'Forbidden');
        return;
      }

      // Send connected message
      socket.send(JSON.stringify({
        type: 'connected',
        path: configPath,
        user: user.sub,
        notifications: config.notifications.type,
      }));

      // Subscribe to changes via broker
      subscription = await subscribeToChanges(configPath, (event) => {
        // Filter out changes for paths the user doesn't have access to
        if (event.path && !hasReadPermission(user, event.path)) {
          return;
        }

        const message = {
          type: 'change',
          operation: event.operation,
          path: event.path,
          data: event.data,
          timestamp: event.timestamp,
        };

        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      });

      // Handle client disconnect
      socket.on('close', () => {
        if (subscription) {
          subscription.unsubscribe();
        }
      });

      socket.on('error', (error) => {
        logger.error(error, 'WebSocket error');
        if (subscription) {
          subscription.unsubscribe();
        }
      });
    } catch (error) {
      logger.error(error, 'WebSocket setup error');
      if (subscription) {
        subscription.unsubscribe();
      }
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: 'error', message: 'Internal server error' }));
        socket.close(1011, 'Internal Error');
      }
    }
  });
}
