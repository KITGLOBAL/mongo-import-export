#!/usr/bin/env node

import inquirer from 'inquirer';
import { MongoDBClient } from './mongodb/client.js';
import { exportCollections } from './mongodb/export.js';
import { importCollections } from './mongodb/import.js';
import { ensureFolderExists, clearFolder } from './utils/file.js';
import { logger } from './utils/logger.js';
import { config } from './config.js';

async function promptUser(): Promise<{
  isExport: boolean;
  mongoUri: string;
  dbName: string;
  clearCollections: boolean;
  clearExportFolder: boolean;
}> {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Select action (0 - Export, 1 - Import):',
      choices: [
        { name: '0 - Export', value: 'export' },
        { name: '1 - Import', value: 'import' },
      ],
    },
    {
      type: 'input',
      name: 'mongoUri',
      message: 'Enter MongoDB connection URL:',
      default: config.mongo.uri || undefined,
      validate: (input: string) => (input ? true : 'Connection URL is required'),
    },
  ]);

  let dbName = config.mongo.dbName;
  let clearCollections = false;
  let clearExportFolder = false;

  if (answers.action === 'import') {
    const importAnswers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'createNewDb',
        message: 'Create a new database?',
        default: false,
      },
      {
        type: 'input',
        name: 'dbName',
        message: 'Enter database name:',
        default: config.mongo.dbName || undefined,
        validate: (input: string) => (input ? true : 'Database name is required'),
      },
      {
        type: 'confirm',
        name: 'clearCollections',
        message: 'Clear collections before importing?',
        default: false,
      },
    ]);

    dbName = importAnswers.dbName;
    clearCollections = importAnswers.clearCollections;
  } else {
    const exportAnswers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'clearExportFolder',
        message: 'Clear export folder before starting?',
        default: false,
      },
    ]);

    clearExportFolder = exportAnswers.clearExportFolder;
    logger.info(`Export will be performed to folder "${config.paths.dataFolder}" with files named after collections.`);
  }

  return {
    isExport: answers.action === 'export',
    mongoUri: answers.mongoUri,
    dbName,
    clearCollections,
    clearExportFolder,
  };
}

async function main() {
  const { isExport, mongoUri, dbName, clearCollections, clearExportFolder } = await promptUser();

  config.mongo.uri = mongoUri;
  config.mongo.dbName = dbName;

  let client: MongoDBClient | undefined;

  try {
    await ensureFolderExists();

    if (isExport && clearExportFolder) {
      await clearFolder();
    }

    client = new MongoDBClient();
    const db = await client.connect();

    if (isExport) {
      await exportCollections(db);
    } else {
      await importCollections(db, clearCollections);
    }
  } catch (error) {
    logger.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

main();