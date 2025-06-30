import { Db, Document, OptionalId, AnyBulkWriteOperation } from 'mongodb';
import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { convertExtendedJSON } from './convert.js';
import ora from 'ora';

export type ConflictStrategy = 'upsert' | 'skip' | 'insert';

function getCollectionName(fileName: string): string | null {
  const match = fileName.match(/^(.+)\.json$/);
  return match ? match[1] : null;
}

export async function importCollections(
  db: Db,
  clearCollections: boolean,
  conflictStrategy: ConflictStrategy = 'insert',
): Promise<void> {
  const files = await fs.readdir(config.paths.dataFolder);
  const jsonFiles = files.filter(file => file.endsWith('.json'));

  if (jsonFiles.length === 0) {
    logger.warn('No JSON files found in the folder for import');
    return;
  }

  const spinner = ora('Starting import...').start();

  for (const file of jsonFiles) {
    const collectionName = getCollectionName(file);
    if (!collectionName) {
      logger.warn(`Invalid file name: ${file}. Skipping.`);
      continue;
    }

    spinner.text = `Importing file: ${file}`;

    try {
      const filePath = path.join(config.paths.dataFolder, file);
      const fileContent = await fs.readFile(filePath, 'utf8');
      let data: unknown;

      try {
        data = JSON.parse(fileContent);
      } catch (parseError) {
        spinner.fail(`Error parsing JSON in file ${file}: ${(parseError as Error).message}`);
        logger.error(`Error parsing JSON in file ${file}: ${(parseError as Error).message}`);
        continue;
      }

      if (!Array.isArray(data)) {
        spinner.warn(`File ${file} does not contain an array of documents. Skipping.`);
        logger.warn(`File ${file} does not contain an array of documents. Skipping.`);
        continue;
      }

      const convertedData: OptionalId<Document>[] = data.map(convertExtendedJSON);
      logger.debug(`Converted data for ${collectionName}: ${JSON.stringify(convertedData.slice(0, 1), null, 2)}`);

      if (clearCollections) {
        spinner.text = `Clearing collection: ${collectionName}`;
        await db.collection(collectionName).deleteMany({});
        logger.info(`Collection ${collectionName} cleared`);
      }

      if (convertedData.length > 0) {
        if (clearCollections || conflictStrategy === 'insert') {
          spinner.text = `Inserting ${convertedData.length} documents into ${collectionName}`;
          await db.collection(collectionName).insertMany(convertedData);
          spinner.succeed(`Successfully inserted ${convertedData.length} documents to collection ${collectionName}`);
        } else {
          let operations: AnyBulkWriteOperation[];

          if (conflictStrategy === 'upsert') {
            spinner.text = `Upserting ${convertedData.length} documents in ${collectionName}`;
            operations = convertedData.map(doc => ({
              replaceOne: {
                filter: { _id: doc._id },
                replacement: doc,
                upsert: true,
              },
            }));
          } else { // 'skip'
            spinner.text = `Skipping existing documents while inserting into ${collectionName}`;
            operations = convertedData.map(doc => ({
              updateOne: {
                filter: { _id: doc._id },
                update: { $setOnInsert: doc },
                upsert: true,
              },
            }));
          }

          const result = await db.collection(collectionName).bulkWrite(operations);
          const { insertedCount, modifiedCount, upsertedCount } = result;
          spinner.succeed(
            `Import to ${collectionName} complete. Inserted: ${insertedCount + upsertedCount}, Modified: ${modifiedCount}.`,
          );
        }
      } else {
        spinner.info(`File ${file} is empty, nothing imported`);
        logger.info(`File ${file} is empty, nothing imported`);
      }
    } catch (error) {
      spinner.fail(`Error importing file ${file}: ${(error as Error).message}`);
      logger.error(`Error importing file ${file}: ${(error as Error).message}`);
    }
  }

  spinner.stop();
  logger.info('Import completed');
}