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

  const bar = multibar.create(documents.length, 0, { collection: collectionName, prefix: '⏳', speed: '0.00' });
  const batchSize = config.batchSize;
  const startTime = Date.now();
  let lastUpdateTime = 0;
  const updateInterval = 100;

  try {
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

      const currentTime = Date.now();
      if (currentTime - lastUpdateTime >= updateInterval) {
        const elapsedTime = (currentTime - startTime) / 1000;
        const speed = ((i + batch.length) / (elapsedTime || 1)).toFixed(2);
        bar.update(i + batch.length, { prefix: '⏳', speed });
        lastUpdateTime = currentTime;
      }
    }

    const elapsedTime = (Date.now() - startTime) / 1000;
    const speed = (documents.length / (elapsedTime || 1)).toFixed(2);
    bar.update(documents.length, { prefix: '✅', speed });
    logger.info(`Successfully processed ${documents.length} documents for collection ${collectionName}`);

  } catch (error) {
    bar.update(documents.length, { prefix: '⚠️', speed: 'Error' });
    throw error;
  }
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
  const startTime = Date.now();
  let lastOverallUpdateTime = 0;
  const overallUpdateInterval = 1000;

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

  console.log('\nStarting import process...\n');
  const multibar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: `${colors.green('{prefix}')} ${colors.green('{bar}')} ${colors.blue('{percentage}%')} | ${colors.cyan('{collection}')} | {value}/{total} Docs | ETA: {eta_formatted} | Speed: ${colors.yellow('{speed}')} docs/s`,
    barCompleteChar: '■',
    barIncompleteChar: '□',
  }, cliProgress.Presets.rect);

  const totalFiles = dataFiles.length;
  const overallBar = multibar.create(totalFiles, 0, {
    collection: 'Overall Progress',
    prefix: '📊',
    format: `${colors.magenta('{prefix}')} ${colors.magenta('{bar}')} ${colors.blue('{percentage}%')} | ${colors.cyan('{collection}')} | {value}/{total} Files`,
  });

  let completedFiles = 0;

  for (const file of dataFiles) {
    const collectionName = getCollectionName(file);
    if (!collectionName) {
      logger.warn(`Invalid file name: ${file}. Skipping.`);
      importErrors.push({ file, reason: 'Invalid file name' });
      completedFiles++;
      const currentTime = Date.now();
      if (currentTime - lastOverallUpdateTime >= overallUpdateInterval) {
        overallBar.update(completedFiles);
        lastOverallUpdateTime = currentTime;
      }
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
          completedFiles++;
          const currentTime = Date.now();
          if (currentTime - lastOverallUpdateTime >= overallUpdateInterval) {
            overallBar.update(completedFiles);
            lastOverallUpdateTime = currentTime;
          }
          continue;
        }

        const fileContentForHash = await fs.readFile(filePath);
        const actualHash = crypto.createHash('sha256').update(fileContentForHash).digest('hex');

        if (actualHash !== expectedHash) {
          const reason = `Checksum mismatch for ${file}! File may be corrupt. Skipping.`;
          logger.error(reason);
          importErrors.push({ file, reason: 'Checksum mismatch' });
          completedFiles++;
          const currentTime = Date.now();
          if (currentTime - lastOverallUpdateTime >= overallUpdateInterval) {
            overallBar.update(completedFiles);
            lastOverallUpdateTime = currentTime;
          }
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
      const bar = multibar.create(0, 0, { collection: collectionName, prefix: '⚠️', speed: 'Error' });
      multibar.remove(bar);
    }

    completedFiles++;
    const currentTime = Date.now();
    if (currentTime - lastOverallUpdateTime >= overallUpdateInterval) {
      overallBar.update(completedFiles);
      lastOverallUpdateTime = currentTime;
    }
  }

  overallBar.update(completedFiles);
  multibar.stop();

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  logger.info('\n📊 Import Summary:');
  logger.info(`Total Files Processed: ${dataFiles.length}`);
  logger.info(`Successful Imports: ${dataFiles.length - importErrors.length}`);
  logger.info(`Failed Imports: ${importErrors.length}`);
  if (importErrors.length > 0) {
    logger.warn('  Failed Files:');
    for (const { file, reason } of importErrors) {
      logger.warn(`    - ${file}: ${reason}`);
    }
  }
  logger.info(`Verification Enabled: ${verificationEnabled}`);
  logger.info(`Total Time: ${totalTime} seconds`);

  logger.info('Import completed');
}