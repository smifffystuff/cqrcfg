import { config } from '../config.js';
import { logger } from '../logger.js';
import { verifyToken } from '../middleware/auth.js';
import { subscribeToChanges, supportsSubscription } from '../services/notificationService.js';
import { onLocalChange } from '../services/cacheSync.js';

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

    logger.debug('[SOCKET] New connection attempt from %s', request.ip);

    try {
      // Check if subscriptions are supported
      if (!supportsSubscription()) {
        logger.debug('[SOCKET] Rejecting connection - subscriptions not supported');
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
        logger.debug('[SOCKET] Rejecting connection - no token provided');
        socket.send(JSON.stringify({ type: 'error', message: 'Missing authentication token' }));
        socket.close(1008, 'Unauthorized');
        return;
      }

      // Verify token
      try {
        user = await verifyToken(token, request.headers);
        logger.debug('[SOCKET] Token verified for user=%s', user.sub);
      } catch (error) {
        logger.debug('[SOCKET] Token verification failed: %s', error.message);
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
        socket.close(1008, 'Unauthorized');
        return;
      }

      // Normalize and validate path
      let configPath;
      try {
        configPath = normalizePath(request.url);
        logger.debug('[SOCKET] Normalized path=%s from url=%s', configPath, request.url);
      } catch (error) {
        logger.debug('[SOCKET] Path normalization failed: %s', error.message);
        socket.send(JSON.stringify({ type: 'error', message: error.message }));
        socket.close(1008, 'Bad Request');
        return;
      }

      // Check authorization
      if (!hasReadPermission(user, configPath)) {
        logger.debug('[SOCKET] Access denied for user=%s path=%s', user.sub, configPath);
        socket.send(JSON.stringify({
          type: 'error',
          message: `Access denied: no read permission for ${configPath}`,
        }));
        socket.close(1008, 'Forbidden');
        return;
      }

      // Send connected message
      logger.debug('[SOCKET] Sending connected message to user=%s path=%s', user.sub, configPath);
      socket.send(JSON.stringify({
        type: 'connected',
        path: configPath,
        user: user.sub,
        notifications: config.notifications.type,
      }));

      // Handler for sending change events to this client
      function sendChangeEvent(event) {
        // Filter: must be under the subscribed path
        if (event.path !== configPath && !event.path.startsWith(configPath + '/')) {
          return;
        }
        // Filter out changes for paths the user doesn't have access to
        if (event.path && !hasReadPermission(user, event.path)) {
          logger.debug('[SOCKET] Filtering event for path=%s - user=%s lacks permission', event.path, user.sub);
          return;
        }

        const message = {
          type: 'change',
          operation: event.operation,
          path: event.path,
          data: event.data,
          timestamp: event.timestamp,
          revision: event.revision || null,
        };

        if (socket.readyState === socket.OPEN) {
          logger.debug('[SOCKET] Sending change event to user=%s: op=%s path=%s', user.sub, event.operation, event.path);
          socket.send(JSON.stringify(message));
        } else {
          logger.debug('[SOCKET] Skipping send - socket not open (readyState=%d)', socket.readyState);
        }
      }

      // Subscribe to local changes via broker
      logger.debug('[SOCKET] Subscribing to changes for path=%s', configPath);
      subscription = await subscribeToChanges(configPath, sendChangeEvent);

      // Subscribe to cross-instance changes
      const unsubRemote = onLocalChange(sendChangeEvent);

      // Handle client disconnect
      socket.on('close', (code, reason) => {
        logger.debug('[SOCKET] Client disconnected user=%s path=%s code=%d reason=%s', user.sub, configPath, code, reason);
        if (subscription) {
          subscription.unsubscribe();
        }
        unsubRemote();
      });

      socket.on('error', (error) => {
        logger.error(error, 'WebSocket error');
        logger.debug('[SOCKET] Socket error for user=%s path=%s: %s', user.sub, configPath, error.message);
        if (subscription) {
          subscription.unsubscribe();
        }
        unsubRemote();
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
