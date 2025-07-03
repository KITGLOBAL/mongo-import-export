import * as crypto from 'crypto';
import { Db, Document, OptionalId, AnyBulkWriteOperation } from 'mongodb';
import { promises as fs, createReadStream } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { convertExtendedJSON, convertCSVRow } from './convert.js';
import cliProgress from 'cli-progress';
import colors from 'ansi-colors';
import Papa from 'papaparse';
import StreamChain from 'stream-chain';
const { chain } = StreamChain;
import Parser from 'stream-json/Parser.js';
import StreamArray from 'stream-json/streamers/StreamArray.js';

export type ConflictStrategy = 'upsert' | 'skip' | 'insert';
export type DataFormat = 'json' | 'csv';

function getCollectionName(fileName: string): string | null {
  const match = fileName.match(/^(.+)\.(json|csv)$/);
  return match ? match[1] : null;
}

async function executeDbBatch(
  db: Db,
  collectionName: string,
  batch: OptionalId<Document>[],
  clearCollections: boolean,
  conflictStrategy: ConflictStrategy,
) {
  if (batch.length === 0) {
    logger.info(`File for ${collectionName} is empty, nothing imported`);
    return;
  }

  const collection = db.collection(collectionName);
  if (clearCollections) {
    await collection.deleteMany({});
    logger.info(`Collection ${collectionName} cleared`);
  }

  if (conflictStrategy === 'insert' || clearCollections) {
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

  const collectionInfo: { file: string; collectionName: string; totalDocuments: number }[] = [];
  const countErrors: { file: string; reason: string }[] = [];
  for (const file of dataFiles) {
    const collectionName = getCollectionName(file);
    if (!collectionName) {
      countErrors.push({ file, reason: 'Invalid file name' });
      continue;
    }

    const filePath = path.join(config.paths.dataFolder, file);
    let totalDocuments = 0;

    try {
      if (verificationEnabled) {
        const expectedHash = checksumMap.get(file);
        if (!expectedHash) {
          throw new Error(`No checksum found for ${file}.`);
        }
        const fileContentForHash = await fs.readFile(filePath);
        const actualHash = crypto.createHash('sha256').update(fileContentForHash).digest('hex');
        if (actualHash !== expectedHash) {
          throw new Error(`Checksum mismatch for ${file}! File may be corrupt.`);
        }
      }

      if (format === 'json') {
        const stats = await fs.stat(filePath);
        if (stats.size > 2) {
          await new Promise<void>((resolve, reject) => {
            const countPipeline = chain([
              createReadStream(filePath, 'utf8'),
              new Parser(),
              new StreamArray(),
            ]);
            countPipeline.on('data', () => totalDocuments++);
            countPipeline.on('end', () => resolve());
            countPipeline.on('error', (error) => {
              logger.warn(`Failed to parse JSON for ${file} during count: ${error.message}`);
              reject(new Error(`Checksum mismatch for ${file}! File may be corrupt (parsing error: ${error.message}).`));
            });
          });
        }
      } else { // CSV
        const fileContent = await fs.readFile(filePath, 'utf8');
        const parsed = Papa.parse(fileContent, { header: true, skipEmptyLines: true });
        totalDocuments = parsed.data.length;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to count documents for ${file}: ${errorMessage}`);
      countErrors.push({ file, reason: errorMessage });
      totalDocuments = 1;
    }

    collectionInfo.push({ file, collectionName, totalDocuments });
  }

  if (collectionInfo.length === 0) {
    logger.warn(`No valid ${format} files with documents found for import`);
    return;
  }

  console.log('\nStarting import process...\n');
  const multibar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: `${colors.green('{prefix}')} ${colors.green('{bar}')} ${colors.blue('{percentage}%')} | ${colors.cyan('{collection}')} | {value}/{total} Docs | ETA: {eta_formatted} | Speed: ${colors.yellow('{speed}')} docs/s`,
    barCompleteChar: '■',
    barIncompleteChar: '□',
    autopadding: true,
  }, cliProgress.Presets.rect);

  const totalFiles = collectionInfo.length;
  const overallBar = multibar.create(totalFiles, 0, {
    collection: 'Overall Progress',
    prefix: '📊',
    format: `${colors.magenta('{prefix}')} ${colors.magenta('{bar}')} ${colors.blue('{percentage}%')} | ${colors.cyan('{collection}')} | {value}/{total} Files`,
  });

  const progressBars = new Map<string, cliProgress.SingleBar>();
  for (const { collectionName, totalDocuments } of collectionInfo) {
    const bar = multibar.create(totalDocuments, 0, {
      collection: collectionName,
      prefix: '⏳',
      speed: '0.00',
    });
    progressBars.set(collectionName, bar);
  }

  const importErrors: { file: string; reason: string }[] = [...countErrors];
  const startTime = Date.now();

  for (const { file, collectionName, totalDocuments } of collectionInfo) {
    const filePath = path.join(config.paths.dataFolder, file);
    const bar = progressBars.get(collectionName)!;

    const countError = countErrors.find(err => err.file === file);
    if (countError) {
      bar.update(totalDocuments, { prefix: '⚠️', speed: '0.00' });
      overallBar.increment();
      continue;
    }

    try {
      if (verificationEnabled) {
        const expectedHash = checksumMap.get(file);
        if (!expectedHash) {
          throw new Error(`No checksum found for ${file}.`);
        }
        const fileContentForHash = await fs.readFile(filePath);
        const actualHash = crypto.createHash('sha256').update(fileContentForHash).digest('hex');
        if (actualHash !== expectedHash) {
          throw new Error(`Checksum mismatch for ${file}! File may be corrupt.`);
        }
        logger.info(`Checksum for ${file} verified.`);
      }

      let shouldClear = clearCollections;

      if (format === 'json') {
        await new Promise<void>((resolve, reject) => {
          const pipeline = chain([
            createReadStream(filePath, 'utf8'),
            new Parser(),
            new StreamArray(),
          ]);

          let batch: OptionalId<Document>[] = [];
          let processedCount = 0;
          const collectionStartTime = Date.now();
          let lastUpdateTime = collectionStartTime;

          pipeline.on('data', async (data: { key: number; value: any }) => {
            pipeline.pause();
            const convertedDoc = convertExtendedJSON(data.value);
            batch.push(convertedDoc);
            processedCount++;

            const currentTime = Date.now();
            if (batch.length >= config.batchSize || currentTime - lastUpdateTime >= 100) {
              if (batch.length > 0) {
                await executeDbBatch(db, collectionName, batch, shouldClear, conflictStrategy);
                shouldClear = false;
              }
              const elapsedTime = Math.max((currentTime - collectionStartTime) / 1000, 0.01);
              const speed = (processedCount / elapsedTime).toFixed(2);
              bar.update(processedCount, { speed });
              lastUpdateTime = currentTime;
              batch = [];
            }
            pipeline.resume();
          });

          pipeline.on('end', async () => {
            if (batch.length > 0) {
              await executeDbBatch(db, collectionName, batch, shouldClear, conflictStrategy);
            }
            const elapsedTime = Math.max((Date.now() - collectionStartTime) / 1000, 0.01);
            const speed = (processedCount / elapsedTime).toFixed(2);
            bar.update(processedCount, { prefix: '✅', speed });
            logger.info(`Processed ${processedCount} documents for ${collectionName} at ${speed} docs/s`);
            resolve();
          });

          pipeline.on('error', (error) => {
            reject(new Error(`Checksum mismatch for ${file}! File may be corrupt (parsing error: ${error.message}).`));
          });
        });

      } else { // CSV
        const fileContent = await fs.readFile(filePath, 'utf8');
        const parsed = Papa.parse(fileContent, { header: true, skipEmptyLines: true });
        const documents = parsed.data.map(row => convertCSVRow(row as { [key: string]: any }));

        let processedCount = 0;
        const collectionStartTime = Date.now();
        let lastUpdateTime = collectionStartTime;

        for (let i = 0; i < documents.length; i += config.batchSize) {
          const batch = documents.slice(i, i + config.batchSize);
          await executeDbBatch(db, collectionName, batch, shouldClear, conflictStrategy);
          shouldClear = false;
          processedCount += batch.length;

          const currentTime = Date.now();
          if (currentTime - lastUpdateTime >= 100) {
            const elapsedTime = Math.max((currentTime - collectionStartTime) / 1000, 0.01);
            const speed = (processedCount / elapsedTime).toFixed(2);
            bar.update(processedCount, { speed });
            lastUpdateTime = currentTime;
          }
        }

        const elapsedTime = Math.max((Date.now() - collectionStartTime) / 1000, 0.01);
        const speed = (processedCount / elapsedTime).toFixed(2);
        bar.update(documents.length, { prefix: '✅', speed });
        logger.info(`Processed ${documents.length} documents for ${collectionName} at ${speed} docs/s`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error importing file ${file}: ${errorMessage}`);
      importErrors.push({ file, reason: errorMessage });
      bar.update(totalDocuments, { prefix: '⚠️', speed: '0.00' });
    }

    overallBar.increment();
  }

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