import { MongoClient, Db } from 'mongodb';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export class MongoDBClient {
  private client: MongoClient;

  constructor() {
    this.client = new MongoClient(config.mongo.uri);
  }

  async connect(): Promise<Db> {
    await this.client.connect();
    logger.info('Подключено к MongoDB');
    const db = this.client.db(config.mongo.dbName);
    await this.ensureDatabaseExists(db);
    return db;
  }

  async close(): Promise<void> {
    await this.client.close();
    logger.info('Соединение с MongoDB закрыто');
  }

  private async ensureDatabaseExists(db: Db): Promise<void> {
    const adminDb = this.client.db('admin');
    const dbs = await adminDb.command({ listDatabases: 1 });
    const dbExists = dbs.databases.some((d: { name: string }) => d.name === config.mongo.dbName);
    logger.info(
      dbExists
        ? `База данных ${config.mongo.dbName} уже существует`
        : `База данных ${config.mongo.dbName} будет создана при добавлении первой коллекции`,
    );
  }
}