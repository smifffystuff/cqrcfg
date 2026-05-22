import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
  BatchWriteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { StorageInterface, globToRegex, matchesFilter } from './interface.js';
import { logger } from '../logger.js';

export class DynamoDBStorage extends StorageInterface {
  constructor(options) {
    super();
    this.tableName = options.tableName || 'cqrcfg';
    this.region = options.region || 'us-east-1';
    this.endpoint = options.endpoint; // For local development
    this.client = null;
    this.docClient = null;
  }

  async connect() {
    if (this.docClient) return;

    const clientConfig = {
      region: this.region,
    };

    if (this.endpoint) {
      clientConfig.endpoint = this.endpoint;
    }

    this.client = new DynamoDBClient(clientConfig);
    this.docClient = DynamoDBDocumentClient.from(this.client, {
      marshallOptions: { removeUndefinedValues: true },
    });

    await this._ensureTable();
    logger.info({ tableName: this.tableName }, 'Connected to DynamoDB');
  }

  async _ensureTable() {
    try {
      await this.client.send(new DescribeTableCommand({
        TableName: this.tableName,
      }));
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        await this.client.send(new CreateTableCommand({
          TableName: this.tableName,
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'path', KeyType: 'RANGE' },
          ],
          AttributeDefinitions: [
            { AttributeName: 'pk', AttributeType: 'S' },
            { AttributeName: 'path', AttributeType: 'S' },
          ],
          BillingMode: 'PAY_PER_REQUEST',
        }));

        // Wait for table to be active
        let active = false;
        while (!active) {
          await new Promise(r => setTimeout(r, 1000));
          const desc = await this.client.send(new DescribeTableCommand({
            TableName: this.tableName,
          }));
          active = desc.Table.TableStatus === 'ACTIVE';
        }

        logger.info({ tableName: this.tableName }, 'Created DynamoDB table');
      } else {
        throw error;
      }
    }
  }

  async close() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.docClient = null;
      logger.info('Disconnected from DynamoDB');
    }
  }

  _getPartitionKey(path) {
    // Use first two segments as partition key for better distribution
    // e.g., /config/app1/db -> config/app1
    const segments = path.split('/').filter(Boolean);
    if (segments.length >= 2) {
      return segments.slice(0, 2).join('/');
    }
    return segments[0] || 'config';
  }

  async getByPrefix(pathPrefix) {
    // For prefix queries, we need to scan or use begins_with
    // Since paths can span partitions, we'll use a scan with filter
    // For production, consider a GSI on path
    const results = [];
    let lastKey = undefined;

    do {
      const response = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(#path, :prefix)',
        ExpressionAttributeNames: { '#path': 'path' },
        ExpressionAttributeValues: {
          ':pk': this._getPartitionKey(pathPrefix),
          ':prefix': pathPrefix,
        },
        ExclusiveStartKey: lastKey,
      }));

      for (const item of response.Items || []) {
        // Verify boundary match (not /app1 matching /app10)
        if (item.path === pathPrefix || item.path.startsWith(pathPrefix + '/')) {
          results.push({
            path: item.path,
            data: item.data,
            updatedAt: new Date(item.updatedAt),
          });
        }
      }

      lastKey = response.LastEvaluatedKey;
    } while (lastKey);

    return results;
  }

  async getByPath(path) {
    const response = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: {
        pk: this._getPartitionKey(path),
        path,
      },
    }));

    if (!response.Item) return null;

    return {
      path: response.Item.path,
      data: response.Item.data,
      updatedAt: new Date(response.Item.updatedAt),
    };
  }

  async getByPathWithFilter(path, filters) {
    const doc = await this.getByPath(path);
    if (!doc) return null;

    // DynamoDB doesn't support nested JSON queries, filter in memory
    if (!matchesFilter(doc.data, filters)) return null;

    return doc;
  }

  async upsert(path, data) {
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        pk: this._getPartitionKey(path),
        path,
        data,
        updatedAt: new Date().toISOString(),
      },
    }));
  }

  async deleteByPrefix(pathPrefix) {
    // First get all matching items
    const items = await this.getByPrefix(pathPrefix);

    if (items.length === 0) return 0;

    // Delete in batches of 25 (DynamoDB limit)
    const batches = [];
    for (let i = 0; i < items.length; i += 25) {
      batches.push(items.slice(i, i + 25));
    }

    for (const batch of batches) {
      await this.docClient.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: batch.map(item => ({
            DeleteRequest: {
              Key: {
                pk: this._getPartitionKey(item.path),
                path: item.path,
              },
            },
          })),
        },
      }));
    }

    return items.length;
  }

  async listPaths(pathPrefix) {
    const items = await this.getByPrefix(pathPrefix);
    return items.map(item => item.path);
  }

  async searchPaths(pattern) {
    // DynamoDB doesn't support regex natively, so we scan and filter
    // For production with large datasets, consider using OpenSearch/Elasticsearch
    const regex = globToRegex(pattern);
    const results = [];
    let lastKey = undefined;

    do {
      const response = await this.docClient.send(new ScanCommand({
        TableName: this.tableName,
        ProjectionExpression: '#path',
        ExpressionAttributeNames: { '#path': 'path' },
        ExclusiveStartKey: lastKey,
      }));

      for (const item of response.Items || []) {
        if (regex.test(item.path)) {
          results.push(item.path);
        }
      }

      lastKey = response.LastEvaluatedKey;
    } while (lastKey);

    return results;
  }

}
