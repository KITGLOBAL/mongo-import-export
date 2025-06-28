#!/usr/bin/env node

import { program } from 'commander';
import inquirer from 'inquirer';
import { MongoDBClient } from './mongodb/client.js';
import { exportCollections } from './mongodb/export.js';
import { importCollections } from './mongodb/import.js';
import { ensureFolderExists, clearFolder } from './utils/file.js';
import { logger } from './utils/logger.js';
import { config } from './config.js';

interface CLIOptions {
  export?: boolean;
  import?: boolean;
  clearCollections?: boolean;
  clearFolder?: boolean;
}

async function promptUser(): Promise<{
  isExport: boolean;
  mongoUri: string;
  dbName: string;
  clearCollections: boolean;
}> {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Выберите действие (0 - Экспорт, 1 - Импорт):',
      choices: [
        { name: '0 - Экспорт', value: 'export' },
        { name: '1 - Импорт', value: 'import' },
      ],
    },
    {
      type: 'input',
      name: 'mongoUri',
      message: 'Укажите URL подключения к MongoDB:',
      default: config.mongo.uri || undefined, // Убираем default, если пусто
      validate: (input: string) => (input ? true : 'URL обязателен'),
    },
  ]);

  let dbName = config.mongo.dbName;
  let clearCollections = false;

  if (answers.action === 'import') {
    const importAnswers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'createNewDb',
        message: 'Создать новую базу данных?',
        default: false,
      },
      {
        type: 'input',
        name: 'dbName',
        message: 'Укажите имя базы данных:',
        default: config.mongo.dbName || undefined, // Убираем default, если пусто
        validate: (input: string) => (input ? true : 'Имя базы данных обязательно'),
      },
      {
        type: 'confirm',
        name: 'clearCollections',
        message: 'Очистить коллекции перед импортом?',
        default: false,
      },
    ]);

    dbName = importAnswers.dbName;
    clearCollections = importAnswers.clearCollections;
  } else {
    logger.info(`Экспорт будет выполнен в папку "${config.paths.dataFolder}" с файлами, названными по именам коллекций.`);
  }

  return {
    isExport: answers.action === 'export',
    mongoUri: answers.mongoUri,
    dbName,
    clearCollections,
  };
}

async function main() {
  program
    .version('1.0.0')
    .description('MongoDB Importer/Exporter')
    .option('--export', 'Export collections to JSON files')
    .option('--import', 'Import collections from JSON files')
    .option('--clear-collections', 'Clear collections before import')
    .option('--clear-folder', 'Clear export folder before export')
    .parse(process.argv);

  const options: CLIOptions = program.opts();
  let isExport = options.export || !options.import;
  let clearCollections = options.clearCollections || false;
  let clearExportFolder = options.clearFolder || false;
  let mongoUri = config.mongo.uri;
  let dbName = config.mongo.dbName;

  if (!options.export && !options.import) {
    const prompted = await promptUser();
    isExport = prompted.isExport;
    mongoUri = prompted.mongoUri;
    dbName = prompted.dbName;
    clearCollections = prompted.clearCollections;
  }

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
    logger.error(`Ошибка: ${(error as Error).message}`);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

main();