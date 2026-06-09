/**
 * Storage interface definition.
 * All storage implementations must provide these methods.
 */

/**
 * @typedef {Object} ConfigDocument
 * @property {string} path - The config path
 * @property {Object} data - The config data
 * @property {Date} updatedAt - Last update timestamp
 */

/**
 * @typedef {Object.<string, string>} FilterCriteria
 * Key-value pairs for filtering. Keys support dot notation for nested paths.
 * Values are strings that will be coerced to match the actual data type.
 */

/**
 * @typedef {Object} Storage
 * @property {function(): Promise<void>} connect - Initialize connection
 * @property {function(): Promise<void>} close - Close connection
 * @property {function(string): Promise<ConfigDocument[]>} getByPrefix - Get all docs matching path prefix
 * @property {function(string): Promise<ConfigDocument|null>} getByPath - Get single doc by exact path
 * @property {function(string, FilterCriteria): Promise<ConfigDocument|null>} getByPathWithFilter - Get single doc if it matches filter
 * @property {function(string, Object): Promise<void>} upsert - Insert or replace a document
 * @property {function(string): Promise<number>} deleteByPrefix - Delete all docs matching path prefix
 * @property {function(string): Promise<string[]>} listPaths - List all paths under a prefix
 * @property {function(string): Promise<string[]>} searchPaths - Search paths matching a glob pattern
 */

/**
 * Convert glob-style pattern to regex
 * Supports: * (any chars except /), ** (any chars including /), ? (single char)
 */
export function globToRegex(pattern) {
  let regex = '^';
  const specialChars = '\\^$.|+()[]{}';

  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*') {
      if (pattern[i + 1] === '*') {
        regex += '.*';
        i += 2;
      } else {
        regex += '[^/]*';
        i++;
      }
    } else if (char === '?') {
      regex += '[^/]';
      i++;
    } else if (specialChars.includes(char)) {
      regex += '\\' + char;
      i++;
    } else {
      regex += char;
      i++;
    }
  }

  regex += '$';
  return new RegExp(regex);
}

/**
 * Check if a path contains wildcard characters
 */
export function hasWildcard(path) {
  return path.includes('*') || path.includes('?');
}

/**
 * Get a nested value from an object using dot notation
 */
export function getNestedValue(obj, path) {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = current[part];
  }

  return current;
}

/**
 * Compare values with type coercion (query params are strings)
 */
export function valuesMatch(actual, expected) {
  if (String(actual) === expected) return true;

  if (typeof actual === 'number') {
    const num = Number(expected);
    if (!isNaN(num) && actual === num) return true;
  }

  if (typeof actual === 'boolean') {
    if (expected === 'true' && actual === true) return true;
    if (expected === 'false' && actual === false) return true;
  }

  return false;
}

/**
 * Check if an object matches all filter criteria
 */
export function matchesFilter(obj, filters) {
  if (!obj || typeof obj !== 'object') return false;
  if (!filters || Object.keys(filters).length === 0) return true;

  for (const [key, expectedValue] of Object.entries(filters)) {
    const value = getNestedValue(obj, key);
    if (value === undefined) return false;
    if (!valuesMatch(value, expectedValue)) return false;
  }

  return true;
}

export class ConflictError extends Error {
  constructor(path, currentRevision) {
    super(`Conflict: path "${path}" has been modified (current revision: ${currentRevision})`);
    this.name = 'ConflictError';
    this.path = path;
    this.currentRevision = currentRevision;
  }
}

export class StorageInterface {
  async connect() {
    throw new Error('Not implemented');
  }

  async close() {
    throw new Error('Not implemented');
  }

  async sync() {
    // No-op by default — backends that use local replicas (e.g. git) override this
  }

  async getByPrefix(pathPrefix) {
    throw new Error('Not implemented');
  }

  async getByPath(path) {
    throw new Error('Not implemented');
  }

  async getByPathWithFilter(path, filters) {
    throw new Error('Not implemented');
  }

  async upsert(path, data) {
    throw new Error('Not implemented');
  }

  async deleteByPrefix(pathPrefix) {
    throw new Error('Not implemented');
  }

  async listPaths(pathPrefix) {
    throw new Error('Not implemented');
  }

  async searchPaths(pattern) {
    throw new Error('Not implemented');
  }
}
