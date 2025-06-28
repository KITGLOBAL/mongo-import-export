import { Db, Document, OptionalId } from 'mongodb';
import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { convertExtendedJSON } from './convert.js';

function getCollectionName(fileName: string): string | null {
  const match = fileName.match(/^(.+)\.json$/);
  return match ? match[1] : null;
}

export async function importCollections(db: Db, clearCollections: boolean): Promise<void> {
  const files = await fs.readdir(config.paths.dataFolder);
  const jsonFiles = files.filter(file => file.endsWith('.json'));

  if (jsonFiles.length === 0) {
    logger.warn('No JSON files found in the folder for import');
    return;
  }

  for (const file of jsonFiles) {
    const collectionName = getCollectionName(file);
    if (!collectionName) {
      logger.warn(`Invalid file name: ${file}. Skipping.`);
      continue;
    }

    try {
      const filePath = path.join(config.paths.dataFolder, file);
      const fileContent = await fs.readFile(filePath, 'utf8');
      let data: unknown;

      try {
        data = JSON.parse(fileContent);
      } catch (parseError) {
        logger.error(`Error parsing JSON in file ${file}: ${(parseError as Error).message}`);
        continue;
      }

      if (!Array.isArray(data)) {
        logger.warn(`File ${file} does not contain an array of documents. Skipping.`);
        continue;
      }

      const convertedData: OptionalId<Document>[] = data.map(convertExtendedJSON);
      logger.debug(`Converted data for ${collectionName}: ${JSON.stringify(convertedData.slice(0, 1), null, 2)}`);

      if (clearCollections) {
        await db.collection(collectionName).deleteMany({});
        logger.info(`Collection ${collectionName} cleared`);
      }

      let totalInserted = 0;
      for (let i = 0; i < convertedData.length; i += config.batchSize) {
        const batch = convertedData.slice(i, i + config.batchSize);
        await db.collection(collectionName).insertMany(batch);
        totalInserted += batch.length;
        logger.info(`Imported ${batch.length} documents to collection ${collectionName} (batch ${i / config.batchSize + 1})`);
      }

      if (totalInserted > 0) {
        logger.info(`Successfully imported ${totalInserted} documents to collection ${collectionName}`);
      } else {
        logger.info(`File ${file} is empty, nothing imported`);
      }
    } catch (error) {
      logger.error(`Error importing file ${file}: ${(error as Error).message}`);
    }
  }

  logger.info('Import completed');
}