import * as crypto from 'crypto';
import { Db, Document, OptionalId, AnyBulkWriteOperation } from 'mongodb';
import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { convertExtendedJSON, convertCSVRow } from './convert.js';
import cliProgress from 'cli-progress';
import colors from 'ansi-colors';
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
  conflictStrategy: ConflictStrategy,
  multibar: cliProgress.MultiBar,
) {
  if (documents.length === 0) {
    logger.info(`File for ${collectionName} is empty, nothing imported`);
    return;
  }
  
  const collection = db.collection(collectionName);

  if (clearCollections) {
    await collection.deleteMany({});
    logger.info(`Collection ${collectionName} cleared`);
  }
  
  const bar = multibar.create(documents.length, 0, { collection: collectionName });
  const batchSize = config.batchSize;

  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    
    if (clearCollections || conflictStrategy === 'insert') {
      await collection.insertMany(batch, { ordered: false }).catch(err => {
        if (err.code !== 11000) throw err;
        logger.warn(`Duplicate key errors were ignored during insert into ${collectionName}`);
      });
    } else {
      let operations: AnyBulkWriteOperation[];
      if (conflictStrategy === 'upsert') {
        operations = batch.map(doc => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }));
      } else {
        operations = batch.map(doc => ({ updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true } }));
      }
      await collection.bulkWrite(operations, { ordered: false });
    }
    bar.increment(batch.length);
  }
  
  logger.info(`Successfully processed ${documents.length} documents for collection ${collectionName}`);
}

export async function importCollections(
  db: Db,
  clearCollections: boolean,
  conflictStrategy: ConflictStrategy = 'insert',
  format: DataFormat,
): Promise<void> {
  const files = await fs.readdir(config.paths.dataFolder);
  const dataFiles = files.filter(file => file.endsWith(`.${format}`));

  if (dataFiles.length === 0) {
    logger.warn(`No .${format} files found in the folder for import`);
    return;
  }

  const checksumMap = new Map<string, string>();
  let verificationEnabled = true;
  const importErrors: { file: string; reason: string }[] = [];

  try {
    const manifestPath = path.join(config.paths.dataFolder, 'manifest.sha256');
    const manifestContent = await fs.readFile(manifestPath, 'utf8');
    manifestContent.split('\n').forEach(line => {
      const [hash, file] = line.split(/ +/);
      if (hash && file) checksumMap.set(file.trim(), hash.trim());
    });
    if (checksumMap.size > 0) logger.info('Checksum manifest loaded. Verification is enabled.');
    else verificationEnabled = false;
  } catch (error) {
    logger.warn('Checksum manifest (manifest.sha256) not found. Proceeding without verification.');
    verificationEnabled = false;
  }
  
  console.log('\nStarting import process...');
  const multibar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: ` {bar} | ${colors.cyan('{collection}')} | {value}/{total} Docs`,
  }, cliProgress.Presets.shades_classic);

  for (const file of dataFiles) {
    const collectionName = getCollectionName(file);
    if (!collectionName) {
      logger.warn(`Invalid file name: ${file}. Skipping.`);
      importErrors.push({ file, reason: 'Invalid file name' });
      continue;
    }
    
    const filePath = path.join(config.paths.dataFolder, file);

    try {
      if (verificationEnabled) {
        const expectedHash = checksumMap.get(file);
        if (!expectedHash) {
          const reason = `No checksum found for ${file}. Skipping.`;
          logger.warn(reason);
          importErrors.push({ file, reason });
          continue;
        }

        const fileContentForHash = await fs.readFile(filePath);
        const actualHash = crypto.createHash('sha256').update(fileContentForHash).digest('hex');

        if (actualHash !== expectedHash) {
          const reason = `Checksum mismatch for ${file}! File may be corrupt. Skipping.`;
          logger.error(reason);
          importErrors.push({ file, reason: 'Checksum mismatch' });
          continue;
        }
        logger.info(`Checksum for ${file} verified.`);
      }
        
      const documents = await parseFileToDocuments(filePath, format);
      await executeDbOperations(db, collectionName, documents, clearCollections, conflictStrategy, multibar);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error importing file ${file}: ${errorMessage}`);
      importErrors.push({ file, reason: errorMessage });
    }
  }

  multibar.stop();

  if (importErrors.length > 0) {
    logger.warn('\n⚠️ IMPORT SUMMARY: Some files failed to import.');
    for (const { file, reason } of importErrors) {
      logger.warn(`  - File: ${file} | Reason: ${reason}`);
    }
  }

  logger.info('Import completed');
}
