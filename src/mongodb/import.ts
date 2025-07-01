import * as crypto from 'crypto';
import { Db, Document, OptionalId, AnyBulkWriteOperation } from 'mongodb';
import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { convertExtendedJSON, convertCSVRow } from './convert.js';
import cliProgress from 'cli-progress';
import Papa from 'papaparse';

export type ConflictStrategy = 'upsert' | 'skip' | 'insert';
export type DataFormat = 'json' | 'csv';

function getCollectionName(fileName: string): string | null {
  const match = fileName.match(/^(.+)\.(json|csv)$/);
  return match ? match[1] : null;
}

async function parseFileToDocuments(filePath: string, format: DataFormat): Promise<OptionalId<Document>[]> {
  const fileContent = await fs.readFile(filePath, 'utf8');

  if (format === 'csv') {
    const parsed = Papa.parse(fileContent, { header: true, skipEmptyLines: true });
    if (parsed.errors.length) {
      logger.warn(`CSV parsing errors in ${path.basename(filePath)}: ${parsed.errors.map(e => e.message).join(', ')}`);
    }
    return parsed.data.map(row => convertCSVRow(row as { [key: string]: any }));
  }

  const data = JSON.parse(fileContent);
  if (!Array.isArray(data)) {
    throw new Error(`File ${path.basename(filePath)} does not contain an array of documents.`);
  }
  return data.map(convertExtendedJSON);
}

async function executeDbOperations(
  db: Db,
  collectionName: string,
  documents: OptionalId<Document>[],
  clearCollections: boolean,
  conflictStrategy: ConflictStrategy
) {
  if (documents.length === 0) {
    logger.info(`File for ${collectionName} is empty, nothing imported`);
    return;
  }
  
  const collection = db.collection(collectionName);

  if (clearCollections) {
    logger.debug(`Clearing collection: ${collectionName}`);
    await collection.deleteMany({});
    logger.info(`Collection ${collectionName} cleared`);
  }

  if (clearCollections || conflictStrategy === 'insert') {
    logger.debug(`Inserting ${documents.length} documents into ${collectionName}`);
    await collection.insertMany(documents, { ordered: false }).catch(err => {
      if (err.code !== 11000) throw err;
      logger.warn(`Duplicate key errors were ignored during insert into ${collectionName}`);
    });
    logger.info(`Successfully processed ${documents.length} documents for collection ${collectionName}`);
  } else {
    let operations: AnyBulkWriteOperation[];
    if (conflictStrategy === 'upsert') {
      logger.debug(`Upserting ${documents.length} documents in ${collectionName}`);
      operations = documents.map(doc => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }));
    } else {
      logger.debug(`Skipping existing documents while inserting into ${collectionName}`);
      operations = documents.map(doc => ({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } }));
    }
    const result = await collection.bulkWrite(operations);
    logger.info(`Import to ${collectionName} complete. Upserted: ${result.upsertedCount}, Inserted: ${result.insertedCount}, Modified: ${result.modifiedCount}.`);
  }
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

  const progressBar = new cliProgress.SingleBar({
    format: 'Importing | {bar} | {file} | {value}/{total} files',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
  });

  const checksumMap = new Map<string, string>();
  let verificationEnabled = true;
  const importErrors: { file: string; reason: string }[] = [];

  try {
    const manifestPath = path.join(config.paths.dataFolder, 'manifest.sha256');
    const manifestContent = await fs.readFile(manifestPath, 'utf8');
    manifestContent.split('\n').forEach(line => {
      const [hash, file] = line.split(/ +/);
      if (hash && file) {
        checksumMap.set(file.trim(), hash.trim());
      }
    });
    if (checksumMap.size > 0) {
      logger.info('Checksum manifest loaded. Verification is enabled.');
    } else {
      verificationEnabled = false;
    }
  } catch (error) {
    logger.warn('Checksum manifest (manifest.sha256) not found. Proceeding without verification.');
    verificationEnabled = false;
  }

  progressBar.start(dataFiles.length, 0, { file: 'N/A' });

  for (const file of dataFiles) {
    progressBar.update({ file });
    const collectionName = getCollectionName(file);
    if (!collectionName) {
      logger.warn(`Invalid file name: ${file}. Skipping.`);
      progressBar.increment();
      continue;
    }

    const filePath = path.join(config.paths.dataFolder, file);

    try {
      if (verificationEnabled) {
        const expectedHash = checksumMap.get(file);
        if (!expectedHash) {
          const reason = `No checksum found for ${file}. Skipping this file as manifest exists.`;
          logger.warn(reason);
          importErrors.push({ file, reason });
          progressBar.increment();
          continue;
        }

        const fileContentForHash = await fs.readFile(filePath);
        const actualHash = crypto.createHash('sha256').update(fileContentForHash).digest('hex');

        if (actualHash !== expectedHash) {
          const reason = `Checksum mismatch for ${file}! The file may be corrupt. Skipping.`;
          logger.error(reason);
          importErrors.push({ file, reason: 'Checksum mismatch' });
          progressBar.increment();
          continue;
        }
        logger.info(`Checksum for ${file} verified.`);
      }
      
      const documents = await parseFileToDocuments(filePath, format);
      await executeDbOperations(db, collectionName, documents, clearCollections, conflictStrategy);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error importing file ${file}: ${errorMessage}`);
      importErrors.push({ file, reason: errorMessage });
    }
    progressBar.increment();
  }

  progressBar.stop();

  if (importErrors.length > 0) {
    logger.warn('⚠️ IMPORT SUMMARY: Some files failed to import.');
    for (const { file, reason } of importErrors) {
      logger.warn(`  - File: ${file} | Reason: ${reason}`);
    }
  } else {
    logger.info('All files were verified and processed successfully.');
  }

  logger.info('Import completed');
}