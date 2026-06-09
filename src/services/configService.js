import { LRUCache } from 'lru-cache';
import { getStorage } from '../storage/index.js';
import { buildTree, deepMerge } from '../utils/tree.js';
import { notifyChange } from './notificationService.js';
import { config } from '../config.js';

// LRU cache for config values
// Uses both max entries and max memory to prevent memory blowup
let cache = null;

function getCache() {
  if (cache) return cache;

  if (!config.cache.enabled) {
    return null;
  }

  cache = new LRUCache({
    // Maximum number of entries
    max: config.cache.maxSize,
    // Maximum memory in bytes
    maxSize: config.cache.maxMemory,
    // Calculate size of each entry (key + JSON serialized value)
    sizeCalculation: (value, key) => {
      // Estimate memory: key length + serialized value length
      const jsonSize = JSON.stringify(value).length * 2; // UTF-16 chars = 2 bytes
      return key.length * 2 + jsonSize;
    },
    // TTL in milliseconds
    ttl: config.cache.ttl * 1000,
    // Update TTL on get
    updateAgeOnGet: false,
    // Don't update TTL on has
    updateAgeOnHas: false,
  });

  return cache;
}

// Cache key prefixes
const CACHE_SUBTREE = 'subtree:';
const CACHE_LIST = 'list:';

function invalidateCacheForPath(path) {
  const c = getCache();
  if (!c) return;

  // Invalidate exact matches
  c.delete(CACHE_SUBTREE + path);
  c.delete(CACHE_LIST + path);

  // Invalidate parent paths (since they may include this path's data)
  const segments = path.split('/').filter(Boolean);
  for (let i = 1; i < segments.length; i++) {
    const parentPath = '/' + segments.slice(0, i).join('/');
    c.delete(CACHE_SUBTREE + parentPath);
    c.delete(CACHE_LIST + parentPath);
  }

  // Note: We don't invalidate child paths because subtree queries
  // are prefix-based and a change to /a/b shouldn't affect cached /a/b/c
}

export async function getSubtree(basePath) {
  const c = getCache();
  const cacheKey = CACHE_SUBTREE + basePath;

  // Check cache first
  if (c) {
    const cached = c.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  const backend = getStorage();
  const docs = await backend.getByPrefix(basePath);

  if (docs.length === 0) {
    // Cache null results too (with shorter TTL handled by LRU)
    if (c) c.set(cacheKey, null);
    return null;
  }

  const result = buildTree(docs, basePath);

  // Cache the result
  if (c) c.set(cacheKey, result);

  return result;
}

export async function listPaths(basePath) {
  const c = getCache();
  const cacheKey = CACHE_LIST + basePath;

  // Check cache first
  if (c) {
    const cached = c.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  const backend = getStorage();
  const paths = await backend.listPaths(basePath);

  // Cache the result (including empty arrays)
  if (c) c.set(cacheKey, paths);

  return paths;
}

export async function searchPaths(pattern) {
  // Search results are not cached since patterns can vary widely
  // and caching regex matches would be complex
  const backend = getStorage();
  // Pattern is now a glob string, conversion to regex happens in storage layer
  const paths = await backend.searchPaths(pattern);

  return paths;
}

export async function getSubtreeWithFilter(basePath, filters) {
  // Filtered queries are not cached since filter combinations vary widely
  const backend = getStorage();
  const doc = await backend.getByPathWithFilter(basePath, filters);

  if (!doc) {
    return null;
  }

  return doc.data;
}

export async function patchNode(path, data, options = {}) {
  const backend = getStorage();
  const existing = await backend.getByPath(path);

  let result;
  let operation;

  if (existing) {
    result = deepMerge(existing.data, data);
    await backend.upsert(path, result, options);
    operation = 'update';
  } else {
    await backend.upsert(path, data, options);
    result = data;
    operation = 'insert';
  }

  // Invalidate cache for affected paths
  invalidateCacheForPath(path);

  // Publish notification
  await notifyChange(operation, path, result);

  return result;
}

export async function putNode(path, data, options = {}) {
  const backend = getStorage();
  const existing = await backend.getByPath(path);

  await backend.upsert(path, data, options);

  // Invalidate cache for affected paths
  invalidateCacheForPath(path);

  // Publish notification
  const operation = existing ? 'update' : 'insert';
  await notifyChange(operation, path, data);

  return data;
}

export async function deleteSubtree(basePath, options = {}) {
  const backend = getStorage();

  // Get paths to delete for notifications
  const docs = await backend.getByPrefix(basePath);
  const count = await backend.deleteByPrefix(basePath, options);

  // Invalidate cache for all deleted paths
  for (const doc of docs) {
    invalidateCacheForPath(doc.path);
  }

  // Publish notifications for each deleted path
  for (const doc of docs) {
    await notifyChange('delete', doc.path);
  }

  return count;
}

// Export for testing/monitoring
export function getCacheStats() {
  const c = getCache();
  if (!c) {
    return { enabled: false };
  }

  return {
    enabled: true,
    size: c.size,
    calculatedSize: c.calculatedSize,
    maxSize: config.cache.maxSize,
    maxMemory: config.cache.maxMemory,
    ttl: config.cache.ttl,
  };
}
