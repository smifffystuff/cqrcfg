import 'dotenv/config';

export const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    host: process.env.HOST || '0.0.0.0',
  },
  storage: {
    type: process.env.STORAGE_TYPE || 'mongodb',
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
      database: process.env.MONGODB_DATABASE || 'cqrcfg',
    },
    dynamodb: {
      tableName: process.env.DYNAMODB_TABLE || 'cqrcfg',
      region: process.env.AWS_REGION || 'us-east-1',
      endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
    },
    etcd: {
      hosts: process.env.ETCD_HOSTS
        ? process.env.ETCD_HOSTS.split(',').map(h => h.trim())
        : ['http://localhost:2379'],
      prefix: process.env.ETCD_PREFIX || '/cqrcfg',
    },
    git: {
      remoteUrl: process.env.GIT_REMOTE_URL || '',
      localPath: process.env.GIT_LOCAL_PATH || '/tmp/cqrcfg-git',
      branch: process.env.GIT_BRANCH || 'main',
      commitAuthor: process.env.GIT_COMMIT_AUTHOR || 'cqrcfg <cqrcfg@localhost>',
      pullInterval: parseInt(process.env.GIT_PULL_INTERVAL, 10) || 30000,
      userName: process.env.GIT_USER_NAME || 'cqrcfg',
      userEmail: process.env.GIT_USER_EMAIL || 'cqrcfg@localhost',
      encryption: {
        salt: process.env.GIT_ENCRYPTION_SALT || '',
        password: process.env.GIT_ENCRYPTION_PASSWORD || '',
      },
    },
  },
  notifications: {
    type: process.env.NOTIFICATIONS_TYPE || 'websocket',
    kafka: {
      brokers: process.env.KAFKA_BROKERS
        ? process.env.KAFKA_BROKERS.split(',').map(b => b.trim())
        : ['localhost:9092'],
      topic: process.env.KAFKA_TOPIC || 'cqrcfg-changes',
      clientId: process.env.KAFKA_CLIENT_ID || 'cqrcfg',
      groupId: process.env.KAFKA_GROUP_ID || 'cqrcfg-group',
    },
    amqp: {
      url: process.env.AMQP_URL || 'amqp://localhost',
      exchange: process.env.AMQP_EXCHANGE || 'cqrcfg',
      exchangeType: process.env.AMQP_EXCHANGE_TYPE || 'topic',
    },
  },
  oidc: {
    jwksUris: process.env.OIDC_JWKS_URIS
      ? process.env.OIDC_JWKS_URIS.split(',').map(u => u.trim()).filter(Boolean)
      : [],
    issuers: process.env.OIDC_ISSUERS
      ? process.env.OIDC_ISSUERS.split(',').map(i => i.trim()).filter(Boolean)
      : [],
    audience: process.env.OIDC_AUDIENCE || undefined,
    claimsHeaders: process.env.OIDC_CLAIMS_HEADERS
      ? process.env.OIDC_CLAIMS_HEADERS.split(',').map(h => h.trim()).filter(Boolean)
      : [],
    // JWKS cache TTL in seconds (0 = no caching, keys fetched every request)
    jwksCacheTtl: parseInt(process.env.OIDC_JWKS_CACHE_TTL, 10) || 120,
    // JWT claim name for permissions (default: cqrcfg_acl)
    aclClaim: process.env.OIDC_ACL_CLAIM || 'cqrcfg_acl',
    // Cache TTL for fetched permissions URLs in seconds (default: 300 = 5 minutes)
    aclCacheTtl: parseInt(process.env.OIDC_ACL_CACHE_TTL, 10) || 300,
  },
  cache: {
    // Enable/disable config value caching
    enabled: process.env.CACHE_ENABLED !== 'false',
    // Maximum number of entries in the cache
    maxSize: parseInt(process.env.CACHE_MAX_SIZE, 10) || 1000,
    // Maximum memory usage in bytes (default 50MB)
    maxMemory: parseInt(process.env.CACHE_MAX_MEMORY, 10) || 50 * 1024 * 1024,
    // TTL in seconds (default 120 = 2 minutes)
    ttl: parseInt(process.env.CACHE_TTL, 10) || 120,
  },
  logLevel: process.env.LOG_LEVEL || 'info',
};

export function validateConfig() {
  const errors = [];

  const hasJwksUris = config.oidc.jwksUris.length > 0;
  const hasIssuers = config.oidc.issuers.length > 0;

  if (!hasJwksUris && !hasIssuers) {
    errors.push('At least one of OIDC_JWKS_URIS or OIDC_ISSUERS is required');
  }

  const validStorage = ['mongodb', 'dynamodb', 'etcd', 'git'];
  if (!validStorage.includes(config.storage.type)) {
    errors.push(`STORAGE_TYPE must be one of: ${validStorage.join(', ')}`);
  }

  
  const validNotifications = ['websocket', 'kafka', 'amqp'];
  if (!validNotifications.includes(config.notifications.type)) {
    errors.push(`NOTIFICATIONS_TYPE must be one of: ${validNotifications.join(', ')}`);
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}
