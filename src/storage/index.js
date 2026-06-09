import { config } from '../config.js';
import { MongoDBStorage } from './mongodb.js';
import { DynamoDBStorage } from './dynamodb.js';
import { EtcdStorage } from './etcd.js';
import { GitStorage } from './git.js';

let storage = null;

export function createStorage() {
  const storageType = config.storage.type;

  switch (storageType) {
    case 'mongodb':
      return new MongoDBStorage({
        uri: config.storage.mongodb.uri,
        database: config.storage.mongodb.database,
      });

    case 'dynamodb':
      return new DynamoDBStorage({
        tableName: config.storage.dynamodb.tableName,
        region: config.storage.dynamodb.region,
        endpoint: config.storage.dynamodb.endpoint,
      });

    case 'etcd':
      return new EtcdStorage({
        hosts: config.storage.etcd.hosts,
        prefix: config.storage.etcd.prefix,
      });

    case 'git':
      return new GitStorage({
        remoteUrl: config.storage.git.remoteUrl,
        localPath: config.storage.git.localPath,
        branch: config.storage.git.branch,
        commitAuthor: config.storage.git.commitAuthor,
        pullInterval: config.storage.git.pullInterval,
        userName: config.storage.git.userName,
        userEmail: config.storage.git.userEmail,
        commitNameClaim: config.storage.git.commitNameClaim,
        commitEmailClaim: config.storage.git.commitEmailClaim,
        encryption: config.storage.git.encryption,
      });

    default:
      throw new Error(`Unknown storage type: ${storageType}`);
  }
}

export async function initStorage() {
  storage = createStorage();
  await storage.connect();
  return storage;
}

export function getStorage() {
  if (!storage) {
    throw new Error('Storage not initialized. Call initStorage() first.');
  }
  return storage;
}

export async function closeStorage() {
  if (storage) {
    await storage.close();
    storage = null;
  }
}
