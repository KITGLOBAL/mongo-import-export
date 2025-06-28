import { Db } from 'mongodb';
import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export async function exportCollections(db: Db): Promise<void> {
  const collections = await db.listCollections().toArray();
  if (collections.length === 0) {
    logger.warn('No collections found in the database for export');
    return;
  }

  logger.info(`Found collections: ${collections.map(c => c.name).join(', ')}`);

  for (const { name } of collections) {
    const collection = db.collection(name);
    const fileName = `${name}.json`;
    const filePath = path.join(config.paths.dataFolder, fileName);

    try {
      const documents = await collection.find({}).toArray();
      if (documents.length === 0) {
        logger.info(`Collection ${name} is empty, no file created`);
        continue;
      }

      await fs.writeFile(filePath, JSON.stringify(documents, null, 2));
      logger.info(`Exported ${documents.length} documents from collection ${name} to ${fileName}`);
      logger.debug(`Exported data for ${name}: ${JSON.stringify(documents.slice(0, 1), null, 2)}`);
    } catch (error) {
      logger.error(`Error exporting collection ${name}: ${(error as Error).message}`);
    }
  }

  logger.info('Export completed');
}