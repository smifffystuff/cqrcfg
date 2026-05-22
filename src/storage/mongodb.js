import { MongoClient } from 'mongodb';
import { StorageInterface, globToRegex, matchesFilter } from './interface.js';
import { logger } from '../logger.js';

const COLLECTION = 'config';

export class MongoDBStorage extends StorageInterface {
  constructor(options) {
    super();
    this.uri = options.uri;
    this.database = options.database;
    this.client = null;
    this.db = null;
  }

  async connect() {
    if (this.db) return;

    this.client = new MongoClient(this.uri);
    await this.client.connect();

    this.db = this.client.db(this.database);

    // Create unique index on path
    await this.db.collection(COLLECTION).createIndex(
      { path: 1 },
      { unique: true }
    );

    logger.info({ database: this.database }, 'Connected to MongoDB');
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      logger.info('Disconnected from MongoDB');
    }
  }

  async getByPrefix(pathPrefix) {
    const collection = this.db.collection(COLLECTION);
    const regex = new RegExp(`^${escapeRegex(pathPrefix)}($|/)`);

    return collection.find({ path: regex }).toArray();
  }

  async getByPath(path) {
    const collection = this.db.collection(COLLECTION);
    return collection.findOne({ path });
  }

  async getByPathWithFilter(path, filters) {
    const collection = this.db.collection(COLLECTION);

    if (!filters || Object.keys(filters).length === 0) {
      return collection.findOne({ path });
    }

    // Build MongoDB query for nested data fields
    const query = { path };
    for (const [key, value] of Object.entries(filters)) {
      const dataKey = `data.${key}`;
      // Try to parse as number or boolean for exact matching
      let parsedValue = value;
      if (value === 'true') parsedValue = true;
      else if (value === 'false') parsedValue = false;
      else if (!isNaN(Number(value)) && value !== '') parsedValue = Number(value);

      // Match either the parsed value or string representation
      query[dataKey] = { $in: [parsedValue, value] };
    }

    return collection.findOne(query);
  }

  async upsert(path, data) {
    const collection = this.db.collection(COLLECTION);

    await collection.updateOne(
      { path },
      {
        $set: {
          path,
          data,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  async deleteByPrefix(pathPrefix) {
    const collection = this.db.collection(COLLECTION);
    const regex = new RegExp(`^${escapeRegex(pathPrefix)}($|/)`);

    const result = await collection.deleteMany({ path: regex });
    return result.deletedCount;
  }

  async listPaths(pathPrefix) {
    const collection = this.db.collection(COLLECTION);
    const regex = new RegExp(`^${escapeRegex(pathPrefix)}($|/)`);

    const docs = await collection.find({ path: regex }, { projection: { path: 1, _id: 0 } }).toArray();
    return docs.map(doc => doc.path);
  }

  async searchPaths(pattern) {
    const collection = this.db.collection(COLLECTION);
    const regex = globToRegex(pattern);
    const docs = await collection.find({ path: regex }, { projection: { path: 1, _id: 0 } }).toArray();
    return docs.map(doc => doc.path);
  }

}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
