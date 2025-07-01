import * as crypto from 'crypto';
import { Db } from 'mongodb';
import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import cliProgress from 'cli-progress';
import colors from 'ansi-colors';
import { DataFormat } from './import.js';
import { config } from '../config.js';
import Papa from 'papaparse';
import { prepareForCSVExport } from './convert.js';

export async function exportCollections(db: Db, format: DataFormat): Promise<void> {
  const collections = await db.listCollections().toArray();

  if (collections.length === 0) {
    logger.warn('No collections found in the database for export');
    return;
  }

  logger.info(`Found collections: ${collections.map(c => c.name).join(', ')}`);

  console.log('\nStarting export process...\n');
  const multibar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: `${colors.green('{prefix}')} ${colors.green('{bar}')} ${colors.blue('{percentage}%')} | ${colors.cyan('{collection}')} | {value}/{total} Docs | ETA: {eta_formatted} | Speed: ${colors.yellow('{speed}')} docs/s`,
    barCompleteChar: '■',
    barIncompleteChar: '□',
  }, cliProgress.Presets.rect);

  const totalCollections = collections.length;
  const overallBar = multibar.create(totalCollections, 0, {
    collection: 'Overall Progress',
    prefix: '📊',
    format: `${colors.magenta('{prefix}')} ${colors.magenta('{bar}')} ${colors.blue('{percentage}%')} | ${colors.cyan('{collection}')} | {value}/{total} Collections`,
  });

  const checksums: { [key: string]: string } = {};
  let completedCollections = 0;
  const exportErrors: { collection: string; reason: string }[] = [];
  const startTime = Date.now();
  let lastOverallUpdateTime = 0;
  const overallUpdateInterval = 1000;

  await Promise.all(collections.map(async ({ name }) => {
    const collection = db.collection(name);
    const totalDocuments = await collection.countDocuments();

    if (totalDocuments === 0) {
      logger.info(`Collection ${name} is empty, skipping.`);
      completedCollections++;
      const currentTime = Date.now();
      if (currentTime - lastOverallUpdateTime >= overallUpdateInterval) {
        overallBar.update(completedCollections);
        lastOverallUpdateTime = currentTime;
      }
      return;
    }

    const bar = multibar.create(totalDocuments, 0, { collection: name, speed: '0.00', prefix: '⏳' });
    const startCollectionTime = Date.now();
    let processedDocuments = 0;
    let lastUpdateTime = 0;
    const updateInterval = 100;

    const fileName = `${name}.${format}`;
    const filePath = path.join(config.paths.dataFolder, fileName);

    try {
      const cursor = collection.find({});
      const documents = [];

      for await (const doc of cursor) {
        documents.push(doc);
        processedDocuments = documents.length;
        const currentTime = Date.now();
        if (currentTime - lastUpdateTime >= updateInterval) {
          const elapsedTime = (currentTime - startCollectionTime) / 1000;
          const speed = (processedDocuments / (elapsedTime || 1)).toFixed(2);
          bar.update(processedDocuments, { speed, prefix: '⏳' });
          lastUpdateTime = currentTime;
        }
      }
      const elapsedTime = (Date.now() - startCollectionTime) / 1000;
      const speed = (processedDocuments / (elapsedTime || 1)).toFixed(2);
      bar.update(processedDocuments, { speed, prefix: '⏳' });

      let fileContent: string;
      if (format === 'csv') {
        fileContent = Papa.unparse(prepareForCSVExport(documents));
      } else {
        fileContent = JSON.stringify(documents, null, 2);
      }

      const hash = crypto.createHash('sha256').update(fileContent);
      checksums[fileName] = hash.digest('hex');

      await fs.writeFile(filePath, fileContent);
      logger.info(`Exported ${processedDocuments} documents from ${name}`);
      bar.update(processedDocuments, { prefix: '✅' });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error exporting collection ${name}: ${errorMessage}`);
      exportErrors.push({ collection: name, reason: errorMessage });
      bar.update(processedDocuments, { prefix: '⚠️', speed: 'Error' });
      multibar.remove(bar);
    }

    completedCollections++;
    const currentTime = Date.now();
    if (currentTime - lastOverallUpdateTime >= overallUpdateInterval) {
      overallBar.update(completedCollections);
      lastOverallUpdateTime = currentTime;
    }
  }));

  overallBar.update(completedCollections);
  multibar.stop();

  if (Object.keys(checksums).length > 0) {
    logger.info('Generating checksum file...');
    const manifestPath = path.join(config.paths.dataFolder, 'manifest.sha256');
    const manifestContent = Object.entries(checksums)
      .map(([file, hash]) => `${hash}  ${file}`)
      .join('\n');
    await fs.writeFile(manifestPath, manifestContent);
    logger.info('Checksum file manifest.sha256 generated.');
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  logger.info('\n📊 Export Summary:');
  logger.info(`  Total Collections: ${collections.length}`);
  logger.info(`  Successful Exports: ${collections.length - exportErrors.length}`);
  logger.info(`  Failed Exports: ${exportErrors.length}`);
  if (exportErrors.length > 0) {
    logger.warn('  Failed Collections:');
    for (const { collection, reason } of exportErrors) {
      logger.warn(`    - ${collection}: ${reason}`);
    }
  }
  logger.info(`  Checksums Generated: ${Object.keys(checksums).length}`);
  logger.info(`  Output Folder: ${config.paths.dataFolder}`);
  logger.info(`  Total Time: ${totalTime} seconds`);

  logger.info('Export completed');
}