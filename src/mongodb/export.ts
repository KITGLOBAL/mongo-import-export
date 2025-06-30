import * as crypto from 'crypto';
import { Db, Document, ObjectId } from 'mongodb';
import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import ora from 'ora';
import { DataFormat } from './import.js';
import Papa from 'papaparse';

function preprocessForCSV(documents: Document[]): Document[] {
  return documents.map(doc => {
    const newDoc: Document = {};
    for (const key in doc) {
      const value = doc[key];
      if (value instanceof ObjectId) {
        newDoc[key] = value.toHexString();
      } else if (value instanceof Date) {
        newDoc[key] = value.toISOString();
      }
      else if (typeof value === 'object' && value !== null) {
        newDoc[key] = JSON.stringify(value);
      } else {
        newDoc[key] = value;
      }
    }
    return newDoc;
  });
}

export async function exportCollections(db: Db, format: DataFormat): Promise<void> {
  const collections = await db.listCollections().toArray();
  if (collections.length === 0) {
    logger.warn('No collections found in the database for export');
    return;
  }

  logger.info(`Found collections: ${collections.map(c => c.name).join(', ')}`);

  const spinner = ora('Starting export...').start();
  const checksums: { [key: string]: string } = {};

  for (const { name } of collections) {
    spinner.text = `Exporting collection: ${name}`;
    const collection = db.collection(name);
    const fileName = `${name}.${format}`;
    const filePath = path.join(config.paths.dataFolder, fileName);

    try {
      const documents = await collection.find({}).toArray();
      if (documents.length === 0) {
        logger.info(`Collection ${name} is empty, no file created`);
        continue;
      }

      let fileContent: string;

      switch (format) {
        case 'csv':
          const preprocessedDocs = preprocessForCSV(documents);
          fileContent = Papa.unparse(preprocessedDocs);
          break;

        case 'json':
        default:
          fileContent = JSON.stringify(documents, null, 2);
          break;
      }

      const hash = crypto.createHash('sha256');
      hash.update(fileContent);
      checksums[fileName] = hash.digest('hex');

      await fs.writeFile(filePath, fileContent);
      spinner.succeed(`Exported ${documents.length} documents from collection ${name} to ${fileName}`);

    } catch (error) {
      spinner.fail(`Error exporting collection ${name}: ${(error as Error).message}`);
      logger.error(`Error exporting collection ${name}: ${(error as Error).message}`);
    }
  }

  if (Object.keys(checksums).length > 0) {
    spinner.text = 'Generating checksum file...';
    const manifestPath = path.join(config.paths.dataFolder, 'manifest.sha256');
    const manifestContent = Object.entries(checksums)
      .map(([file, hash]) => `${hash}  ${file}`)
      .join('\n');
    await fs.writeFile(manifestPath, manifestContent);
    spinner.succeed('Checksum file manifest.sha256 generated.');
  }

  spinner.stop();
  logger.info('Export completed');
}