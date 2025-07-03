import * as crypto from 'crypto';
import { Db } from 'mongodb';
import { promises as fs, createWriteStream } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import cliProgress from 'cli-progress';
import colors from 'ansi-colors';
import { DataFormat } from './import.js';
import { config } from '../config.js';
import Papa from 'papaparse';
import { prepareForCSVExport, prepareForJSONExport } from './convert.js';

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
    format: `${colors.yellow('{prefix}')} ${colors.yellow('{bar}')} ${colors.blue('{percentage}%')} | ${colors.cyan('{collection}')} | {value}/{total} Collections`,
  });

  const progressBars: { [key: string]: cliProgress.SingleBar } = {};
  for (const { name } of collections) {
    const totalDocuments = await db.collection(name).countDocuments();
    if (totalDocuments > 0) {
      progressBars[name] = multibar.create(totalDocuments, 0, { collection: name, speed: '0.00', prefix: '⏳' });
    }
  }

  const checksums: { [key: string]: string } = {};
  let completedCollections = 0;
  const exportErrors: { collection: string; reason: string }[] = [];
  const startTime = Date.now();
  
  for (const { name } of collections) {
    const collection = db.collection(name);
    const totalDocuments = await collection.countDocuments();
    const fileName = `${name}.${format}`;
    const filePath = path.join(config.paths.dataFolder, fileName);

    if (totalDocuments === 0) {
      logger.info(`Collection ${name} is empty, skipping.`);
      const emptyContent = format === 'json' ? '[]' : '';
      await fs.writeFile(filePath, emptyContent);
      checksums[fileName] = crypto.createHash('sha256').update(emptyContent).digest('hex');
      completedCollections++;
      overallBar.update(completedCollections);
      continue;
    }

    const bar = progressBars[name];
    const startCollectionTime = Date.now();
    let lastUpdateTime = 0;
    const updateInterval = 100;
    
    try {
      let processedDocuments = 0;
      if (format === 'json') {
        const cursor = collection.find();
        const fileWriteStream = createWriteStream(filePath, 'utf8');
        fileWriteStream.write('[\n');
        let isFirstDoc = true;

        for await (const doc of cursor) {
          if (!isFirstDoc) {
            fileWriteStream.write(',\n');
          }
          const preparedDoc = prepareForJSONExport(doc);
          fileWriteStream.write(JSON.stringify(preparedDoc, null, 2));
          isFirstDoc = false;
          processedDocuments++;
          
          const currentTime = Date.now();
          if (currentTime - lastUpdateTime >= updateInterval || processedDocuments === totalDocuments) {
            const elapsedTime = (currentTime - startCollectionTime) / 1000;
            const speed = (processedDocuments / (elapsedTime || 1)).toFixed(2);
            bar.update(processedDocuments, { speed });
            lastUpdateTime = currentTime;
          }
        }
        
        fileWriteStream.write('\n]');
        fileWriteStream.end();

        await new Promise<void>((resolve, reject) => {
          fileWriteStream.on('finish', resolve);
          fileWriteStream.on('error', reject);
        });

        bar.update(processedDocuments, { prefix: '✅' });
        logger.info(`Exported ${processedDocuments} documents from ${name}`);

      } else {
        const cursor = collection.find();
        const documents = [];
        
        for await (const doc of cursor) {
            documents.push(doc);
            processedDocuments++;
            const currentTime = Date.now();
            if (currentTime - lastUpdateTime >= updateInterval || processedDocuments === totalDocuments) {
                const elapsedTime = (currentTime - startCollectionTime) / 1000;
                const speed = (processedDocuments / (elapsedTime || 1)).toFixed(2);
                bar.update(processedDocuments, { speed });
                lastUpdateTime = currentTime;
            }
        }
        const fileContent = Papa.unparse(prepareForCSVExport(documents));
        await fs.writeFile(filePath, fileContent);
        logger.info(`Exported ${documents.length} documents from ${name}`);
        bar.update(documents.length, { prefix: '✅' });
      }
      
      const finalFileContent = await fs.readFile(filePath);
      checksums[fileName] = crypto.createHash('sha256').update(finalFileContent).digest('hex');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error exporting collection ${name}: ${errorMessage}`);
      exportErrors.push({ collection: name, reason: errorMessage });
      bar.stop();
      multibar.remove(bar);
    }

    completedCollections++;
    overallBar.update(completedCollections);
  }
  
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
  logger.info(`Total Collections: ${collections.length}`);
  logger.info(`Successful Exports: ${collections.length - exportErrors.length}`);
  logger.info(`Failed Exports: ${exportErrors.length}`);
  if (exportErrors.length > 0) {
    logger.warn('  Failed Collections:');
    for (const { collection, reason } of exportErrors) {
      logger.warn(`    - ${collection}: ${reason}`);
    }
  }
  logger.info(`Checksums Generated: ${Object.keys(checksums).length}`);
  logger.info(`Output Folder: ${config.paths.dataFolder}`);
  logger.info(`Total Time: ${totalTime} seconds`);

  logger.info('Export completed');
}