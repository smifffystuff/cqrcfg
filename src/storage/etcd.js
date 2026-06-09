import { Etcd3 } from 'etcd3';
import { StorageInterface, globToRegex, matchesFilter } from './interface.js';
import { logger } from '../logger.js';

export class EtcdStorage extends StorageInterface {
  constructor(options) {
    super();
    this.hosts = options.hosts || ['http://localhost:2379'];
    this.prefix = options.prefix || '/cqrcfg';
    this.client = null;
  }

  async connect() {
    if (this.client) return;

    this.client = new Etcd3({
      hosts: this.hosts,
    });

    // Test connection
    await this.client.get('__health_check__');
    logger.info({ hosts: this.hosts }, 'Connected to etcd');
  }

  async close() {
    if (this.client) {
      this.client.close();
      this.client = null;
      logger.info('Disconnected from etcd');
    }
  }

  _toEtcdKey(path) {
    // Convert config path to etcd key
    // /config/app1/db -> /cqrcfg/config/app1/db
    return `${this.prefix}${path}`;
  }

  _fromEtcdKey(key) {
    // Convert etcd key back to config path
    return key.slice(this.prefix.length);
  }

  async getByPrefix(pathPrefix) {
    const etcdPrefix = this._toEtcdKey(pathPrefix);
    const response = await this.client.getAll().prefix(etcdPrefix);

    const results = [];
    for (const [key, value] of Object.entries(response)) {
      const path = this._fromEtcdKey(key);

      // Verify boundary match
      if (path === pathPrefix || path.startsWith(pathPrefix + '/')) {
        try {
          const parsed = JSON.parse(value);
          results.push({
            path,
            data: parsed.data,
            updatedAt: new Date(parsed.updatedAt),
          });
        } catch {
          // Skip malformed entries
        }
      }
    }

    return results;
  }

  async getByPath(path) {
    const etcdKey = this._toEtcdKey(path);
    const value = await this.client.get(etcdKey).string();

    if (!value) return null;

    try {
      const parsed = JSON.parse(value);
      return {
        path,
        data: parsed.data,
        updatedAt: new Date(parsed.updatedAt),
      };
    } catch {
      return null;
    }
  }

  async getByPathWithFilter(path, filters) {
    const doc = await this.getByPath(path);
    if (!doc) return null;

    // etcd doesn't support filtering, do it in memory
    if (!matchesFilter(doc.data, filters)) return null;

    return doc;
  }

  async upsert(path, data) {
    const etcdKey = this._toEtcdKey(path);
    const value = JSON.stringify({
      data,
      updatedAt: new Date().toISOString(),
    });

    await this.client.put(etcdKey).value(value);
  }

  async deleteByPrefix(pathPrefix) {
    const etcdPrefix = this._toEtcdKey(pathPrefix);

    // Get all keys first to count and verify boundaries
    const response = await this.client.getAll().prefix(etcdPrefix).keys();

    const keysToDelete = response.filter(key => {
      const path = this._fromEtcdKey(key);
      return path === pathPrefix || path.startsWith(pathPrefix + '/');
    });

    if (keysToDelete.length === 0) return 0;

    // Delete each key
    for (const key of keysToDelete) {
      await this.client.delete().key(key);
    }

    return keysToDelete.length;
  }

  async listPaths(pathPrefix) {
    const items = await this.getByPrefix(pathPrefix);
    return items.map(item => item.path);
  }

  async searchPaths(pattern) {
    // etcd doesn't support regex, so we get all keys and filter
    const regex = globToRegex(pattern);
    const response = await this.client.getAll().prefix(this.prefix).keys();

    const results = [];
    for (const key of response) {
      const path = this._fromEtcdKey(key);
      if (regex.test(path)) {
        results.push(path);
      }
    }

    return results;
  }

}
