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

  console.log('\nStarting export process...');
  const multibar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: ` {bar} | ${colors.cyan('{collection}')} | {value}/{total} Docs | Speed: ${colors.yellow('{speed}')} docs/s`,
  }, cliProgress.Presets.shades_classic);

  const checksums: { [key: string]: string } = {};
  await Promise.all(collections.map(async ({ name }) => {
    const collection = db.collection(name);
    const totalDocuments = await collection.countDocuments();
    
    if (totalDocuments === 0) {
      logger.info(`Collection ${name} is empty, skipping.`);
      return;
    }

    const bar = multibar.create(totalDocuments, 0, { collection: name, speed: '0.00' });
    const startTime = Date.now();

    const fileName = `${name}.${format}`;
    const filePath = path.join(config.paths.dataFolder, fileName);
    
    try {
      const cursor = collection.find({});
      const documents = [];
      
      for await (const doc of cursor) {
        documents.push(doc);
        const elapsedTime = (Date.now() - startTime) / 1000;
        const speed = (documents.length / (elapsedTime || 1)).toFixed(2);
        bar.update(documents.length, { speed });
      }

      let fileContent: string;
      if (format === 'csv') {
        fileContent = Papa.unparse(prepareForCSVExport(documents));
      } else {
        fileContent = JSON.stringify(documents, null, 2);
      }

      const hash = crypto.createHash('sha256').update(fileContent);
      checksums[fileName] = hash.digest('hex');

      await fs.writeFile(filePath, fileContent);
      logger.info(`Exported ${documents.length} documents from ${name}`);

    } catch (error) {
      logger.error(`Error exporting collection ${name}: ${(error as Error).message}`);
      multibar.remove(bar);
    }
  }));

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

  logger.info('Export completed');
}
