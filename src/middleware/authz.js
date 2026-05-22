/**
 * Authorization hook factory - checks subtree permissions
 *
 * @param {string} requiredAction - The action required ('read' or 'write')
 * @returns {Function} Fastify preHandler hook
 */
export function authzHook(requiredAction) {
  return async (request, reply) => {
    const user = request.user;
    const requestedPath = request.configPath;

    if (!user || !requestedPath) {
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Authorization check failed: missing user or path',
      });
    }

    const permissions = user.permissions || [];

    // Check if any permission grants access
    const hasAccess = permissions.some((perm) => {
      // Check if permission path is a valid prefix of the requested path
      if (!isValidPrefix(perm.path, requestedPath)) {
        return false;
      }

      // Check if the required action is allowed
      const actions = perm.allow || [];
      return actions.includes(requiredAction);
    });

    if (!hasAccess) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: `Access denied: no ${requiredAction} permission for path ${requestedPath}`,
      });
    }
  };
}

/**
 * Check if permissionPath is a valid prefix of requestedPath.
 * Ensures proper boundary checking to prevent /app1 matching /app10.
 *
 * Valid cases:
 *   /config/app1 is prefix of /config/app1
 *   /config/app1 is prefix of /config/app1/db
 *
 * Invalid cases:
 *   /config/app1 is NOT prefix of /config/app10
 *   /config/app is NOT prefix of /config/application
 *
 * @param {string} permissionPath - The path from user's permission
 * @param {string} requestedPath - The path being requested
 * @returns {boolean}
 */
function isValidPrefix(permissionPath, requestedPath) {
  // Exact match
  if (permissionPath === requestedPath) {
    return true;
  }

  // Permission path must be a prefix followed by a path separator
  if (requestedPath.startsWith(permissionPath + '/')) {
    return true;
  }

  return false;
}
