import { MongoClient, Db } from 'mongodb';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export class MongoDBClient {
  public client: MongoClient;

  constructor(uri?: string) {
    this.client = new MongoClient(uri || config.mongo.uri);
  }

  async connect(): Promise<Db> {
    await this.client.connect();
    logger.info('Connected to MongoDB');
    const db = this.client.db(config.mongo.dbName);
    return db;
  }

  async listDatabases(): Promise<string[]> {
    try {
      const adminDb = this.client.db('admin').admin();
      const dbs = await adminDb.listDatabases();
      return dbs.databases
        .map((db: { name: string }) => db.name)
        .filter(name => !['admin', 'local', 'config'].includes(name));
    } catch (error) {
      logger.error(`Failed to list databases: ${(error as Error).message}`);
      return [];
    }
  }

  async close(): Promise<void> {
    await this.client.close();
    logger.info('MongoDB connection closed');
  }
}