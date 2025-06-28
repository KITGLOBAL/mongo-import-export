import { Db, Document, OptionalId } from 'mongodb';
import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { convertExtendedJSON } from './convert.js';

function getCollectionName(fileName: string): string | null {
  const match = fileName.match(/^(.+)\.json$/);
  return match ? match[1] : null;
}

export async function importCollections(db: Db, clearCollections: boolean): Promise<void> {
  const files = await fs.readdir(config.paths.dataFolder);
  const jsonFiles = files.filter(file => file.endsWith('.json'));

  if (jsonFiles.length === 0) {
    logger.warn('В папке нет JSON-файлов для импорта');
    return;
  }

  for (const file of jsonFiles) {
    const collectionName = getCollectionName(file);
    if (!collectionName) {
      logger.warn(`Некорректное имя файла: ${file}. Пропускается.`);
      continue;
    }

    try {
      const filePath = path.join(config.paths.dataFolder, file);
      const fileContent = await fs.readFile(filePath, 'utf8');
      let data: unknown;

      try {
        data = JSON.parse(fileContent);
      } catch (parseError) {
        logger.error(`Ошибка парсинга JSON в файле ${file}: ${(parseError as Error).message}`);
        continue;
      }

      if (!Array.isArray(data)) {
        logger.warn(`Файл ${file} не содержит массив документов. Пропускается.`);
        continue;
      }

      const convertedData: OptionalId<Document>[] = data.map(convertExtendedJSON);
      logger.debug(`Преобразованные данные для ${collectionName}: ${JSON.stringify(convertedData.slice(0, 1), null, 2)}`);

      if (clearCollections) {
        await db.collection(collectionName).deleteMany({});
        logger.info(`Коллекция ${collectionName} очищена`);
      }

      let totalInserted = 0;
      for (let i = 0; i < convertedData.length; i += config.batchSize) {
        const batch = convertedData.slice(i, i + config.batchSize);
        await db.collection(collectionName).insertMany(batch);
        totalInserted += batch.length;
        logger.info(`Импортировано ${batch.length} документов в коллекцию ${collectionName} (батч ${i / config.batchSize + 1})`);
      }

      if (totalInserted > 0) {
        logger.info(`Успешно импортировано ${totalInserted} документов в коллекцию ${collectionName}`);
      } else {
        logger.info(`Файл ${file} пустой, ничего не импортировано`);
      }
    } catch (error) {
      logger.error(`Ошибка при импорте файла ${file}: ${(error as Error).message}`);
    }
  }

  logger.info('Импорт завершён');
}