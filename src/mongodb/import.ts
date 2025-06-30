import { Db, Document, OptionalId, AnyBulkWriteOperation, ObjectId } from 'mongodb';
import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { convertExtendedJSON } from './convert.js';
import ora from 'ora';
import Papa from 'papaparse';
import { isValidObjectId, isValidDate } from '../utils/validate.js';

export type ConflictStrategy = 'upsert' | 'skip' | 'insert';
export type DataFormat = 'json' | 'csv';

function getCollectionName(fileName: string): string | null {
  const match = fileName.match(/^(.+)\.(json|csv)$/);
  return match ? match[1] : null;
}

function convertCSVRow(row: { [key: string]: any }): Document {
  const result: Document = {};
  for (let [key, value] of Object.entries(row)) {
    if (value === null || value === '') {
      result[key] = value;
      continue;
    }

    const stringValue = String(value);
    
    if (key === '_id' && isValidObjectId(stringValue)) {
        result[key] = new ObjectId(stringValue);
        continue;
    }
    if ((key.endsWith('At') || key.endsWith('Dt')) && isValidDate(stringValue)) {
        result[key] = new Date(stringValue);
        continue;
    }

    if (isValidObjectId(stringValue)) {
      result[key] = new ObjectId(stringValue);
    } else if (isValidDate(stringValue)) {
        result[key] = new Date(stringValue);
    } else if (!isNaN(Number(stringValue)) && stringValue.trim() !== '') {
        result[key] = Number(stringValue);
    } else if (stringValue.toLowerCase() === 'true' || stringValue.toLowerCase() === 'false') {
        result[key] = (stringValue.toLowerCase() === 'true');
    } else {
      try {
        const parsed = JSON.parse(stringValue);
        result[key] = convertExtendedJSON(parsed);
      } catch (e) {
        result[key] = stringValue;
      }
    }
  }
  return result;
}

export async function importCollections(
  db: Db,
  clearCollections: boolean,
  conflictStrategy: ConflictStrategy = 'insert',
  format: DataFormat
): Promise<void> {
  const files = await fs.readdir(config.paths.dataFolder);
  const dataFiles = files.filter(file => file.endsWith(`.${format}`));

  if (dataFiles.length === 0) {
    logger.warn(`No .${format} files found in the folder for import`);
    return;
  }

  const spinner = ora('Starting import...').start();

  for (const file of dataFiles) {
    const collectionName = getCollectionName(file);
    if (!collectionName) {
      logger.warn(`Invalid file name: ${file}. Skipping.`);
      continue;
    }

    spinner.text = `Importing file: ${file}`;
    const filePath = path.join(config.paths.dataFolder, file);

    try {
      let documents: OptionalId<Document>[];

      switch (format) {
        case 'csv': {
          const fileContent = await fs.readFile(filePath, 'utf8');
          const parsed = Papa.parse(fileContent, { header: true, skipEmptyLines: true });
          if (parsed.errors.length) {
            logger.warn(`CSV parsing errors in ${file}: ${parsed.errors.map(e => e.message).join(', ')}`);
          }
          documents = parsed.data.map(row => convertCSVRow(row as { [key: string]: any }));
          break;
        }
        case 'json':
        default: {
          const fileContent = await fs.readFile(filePath, 'utf8');
          const data = JSON.parse(fileContent);
           if (!Array.isArray(data)) {
            spinner.warn(`File ${file} does not contain an array of documents. Skipping.`);
            logger.warn(`File ${file} does not contain an array of documents. Skipping.`);
            continue;
          }
          documents = data.map(convertExtendedJSON);
          break;
        }
      }
      
      if (clearCollections) {
        spinner.text = `Clearing collection: ${collectionName}`;
        await db.collection(collectionName).deleteMany({});
        logger.info(`Collection ${collectionName} cleared`);
      }

      if (documents.length > 0) {
        if (clearCollections || conflictStrategy === 'insert') {
          spinner.text = `Inserting ${documents.length} documents into ${collectionName}`;
          await db.collection(collectionName).insertMany(documents, { ordered: false }).catch(err => {
            if (err.code !== 11000) throw err;
            logger.warn(`Duplicate key errors were ignored during insert into ${collectionName}`);
          });
          spinner.succeed(`Successfully processed ${documents.length} documents for collection ${collectionName}`);
        } else {
          let operations: AnyBulkWriteOperation[];
          if (conflictStrategy === 'upsert') {
            spinner.text = `Upserting ${documents.length} documents in ${collectionName}`;
            operations = documents.map(doc => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }));
          } else {
            spinner.text = `Skipping existing documents while inserting into ${collectionName}`;
            operations = documents.map(doc => ({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } }));
          }
          const result = await db.collection(collectionName).bulkWrite(operations);
          spinner.succeed(`Import to ${collectionName} complete. Upserted: ${result.upsertedCount}, Inserted: ${result.insertedCount}, Modified: ${result.modifiedCount}.`);
        }
      } else {
        spinner.info(`File ${file} is empty, nothing imported`);
      }

    } catch (error) {
      spinner.fail(`Error importing file ${file}: ${(error as Error).message}`);
      logger.error(`Error importing file ${file}: ${(error as Error).message}`);
    }
  }

  spinner.stop();
  logger.info('Import completed');
}