#!/usr/bin/env node

import inquirer from 'inquirer';
import { URL } from 'url';
import { MongoDBClient } from './mongodb/client.js';
import { exportCollections } from './mongodb/export.js';
import { importCollections, DataFormat } from './mongodb/import.js';
import { ensureFolderExists, clearFolder } from './utils/file.js';
import { logger, flushLogs } from './utils/logger.js';
import { config } from './config.js';

async function promptPrimaryActions(): Promise<{
  action: 'import' | 'export';
  mongoUri: string;
  format: DataFormat;
}> {
  console.log('Welcome to the MongoDB Import/Export Tool!');
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Export data from a database', value: 'export' },
        { name: 'Import data into a database', value: 'import' },
      ],
    },
    {
      type: 'input',
      name: 'mongoUri',
      message: 'Enter your MongoDB connection URI:',
      default: config.mongo.uri || 'mongodb://localhost:27017',
      validate: (input: string) => (input ? true : 'Connection URI is required'),
    },
    {
      type: 'list',
      name: 'format',
      message: 'Select the data format:',
      choices: ['json', 'csv'],
      default: 'json',
    },
  ]);
  return answers;
}

async function main() {
  const { action, mongoUri, format } = await promptPrimaryActions();

  config.mongo.uri = mongoUri;
  let client: MongoDBClient | undefined;

  try {
    await ensureFolderExists();

    if (action === 'export') {
      let dbName: string | undefined;

      try {
        const url = new URL(mongoUri);
        if (url.pathname && url.pathname.length > 1) {
          dbName = url.pathname.substring(1).split('/')[0];
        }
      } catch (e) {
      }

      client = new MongoDBClient();
      await client.client.connect();

      if (!dbName) {
        console.log('Fetching available databases...');
        const availableDbs = await client.listDatabases();

        if (availableDbs.length > 0) {
          const dbAnswer = await inquirer.prompt([
            {
              type: 'list',
              name: 'dbName',
              message: 'Select the database to export:',
              choices: availableDbs,
            },
          ]);
          dbName = dbAnswer.dbName;
        } else {
          logger.warn('Could not automatically find any databases.');
          const dbAnswer = await inquirer.prompt([
            {
              type: 'input',
              name: 'dbName',
              message: 'Please enter the database name to export manually:',
              validate: (input: string) => (input ? true : 'Database name is required'),
            },
          ]);
          dbName = dbAnswer.dbName;
        }
      }

      if (!dbName) {
        throw new Error('Database name was not selected. Aborting.');
      }

      config.mongo.dbName = dbName;

      const db = client.client.db(dbName);

      const { clearExportFolder } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'clearExportFolder',
          message: `Clear export folder (${config.paths.dataFolder}) before starting?`,
          default: false,
        },
      ]);

      if (clearExportFolder) await clearFolder();

      await exportCollections(db, format);

    } else { // Import
      const { dbName, clearCollections, conflictStrategy } = await inquirer.prompt([
        {
          type: 'input',
          name: 'dbName',
          message: 'Enter the database name to import to:',
          default: config.mongo.dbName || undefined,
          validate: (input: string) => (input ? true : 'Database name is required'),
        },
        {
          type: 'confirm',
          name: 'clearCollections',
          message: 'Clear collections before importing? (This will ignore conflict strategy)',
          default: false,
        },
        {
          type: 'list',
          name: 'conflictStrategy',
          message: 'Select conflict resolution strategy:',
          choices: [
            { name: 'Insert (fail on duplicates)', value: 'insert' },
            { name: 'Upsert (replace existing, insert new)', value: 'upsert' },
            { name: 'Skip (ignore duplicates)', value: 'skip' },
          ],
          when: answers => !answers.clearCollections,
        },
      ]);

      config.mongo.dbName = dbName;
      client = new MongoDBClient();
      const db = await client.connect();

      await importCollections(db, clearCollections, conflictStrategy || 'insert', format);
    }
  } catch (error) {
    logger.error(`An unhandled error occurred: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    if (client) {
      await client.close();
    }
    flushLogs();
  }
}

main();