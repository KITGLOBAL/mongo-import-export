import * as crypto from 'crypto';
import { Db, Document } from 'mongodb';
import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import cliProgress from 'cli-progress';
import { DataFormat } from './import.js';
import Papa from 'papaparse';
import { prepareForCSVExport } from './convert.js';

export async function exportCollections(db: Db, format: DataFormat): Promise<void> {
  const collections = await db.listCollections().toArray();
  if (collections.length === 0) {
    logger.warn('No collections found in the database for export');
    return;
  }

  logger.info(`Found collections: ${collections.map(c => c.name).join(', ')}`);
  
  const progressBar = new cliProgress.SingleBar({
    format: 'Exporting | {bar} | {collection} | {value}/{total} collections',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
  });

  progressBar.start(collections.length, 0, { collection: 'N/A' });
  
  const checksums: { [key: string]: string } = {};

  for (const { name } of collections) {
    progressBar.update({ collection: name });
    const collection = db.collection(name);
    const fileName = `${name}.${format}`;
    const filePath = path.join(config.paths.dataFolder, fileName);

    try {
      const documents = await collection.find({}).toArray();
      if (documents.length === 0) {
        logger.info(`Collection ${name} is empty, no file created`);
        progressBar.increment();
        continue;
      }

      let fileContent: string;

      switch (format) {
        case 'csv':
          const preprocessedDocs = prepareForCSVExport(documents);
          fileContent = Papa.unparse(preprocessedDocs);
          break;

        case 'json':
        default:
          fileContent = JSON.stringify(documents, null, 2);
          break;
      }

      const hash = crypto.createHash('sha256').update(fileContent);
      checksums[fileName] = hash.digest('hex');

      await fs.writeFile(filePath, fileContent);
      logger.info(`Exported ${documents.length} documents from collection ${name} to ${fileName}`);

    } catch (error) {
      logger.error(`Error exporting collection ${name}: ${(error as Error).message}`);
    }
    progressBar.increment();
  }
  
  progressBar.stop();

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