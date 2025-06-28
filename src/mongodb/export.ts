import { Db } from 'mongodb';
import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export async function exportCollections(db: Db): Promise<void> {
  const collections = await db.listCollections().toArray();
  if (collections.length === 0) {
    logger.warn('В базе данных нет коллекций для экспорта');
    return;
  }

  logger.info(`Найдены коллекции: ${collections.map(c => c.name).join(', ')}`);

  for (const { name } of collections) {
    const collection = db.collection(name);
    const fileName = `${name}.json`;
    const filePath = path.join(config.paths.dataFolder, fileName);

    try {
      const documents = await collection.find({}).toArray();
      if (documents.length === 0) {
        logger.info(`Коллекция ${name} пуста, файл не создан`);
        continue;
      }

      await fs.writeFile(filePath, JSON.stringify(documents, null, 2));
      logger.info(`Экспортировано ${documents.length} документов из коллекции ${name} в ${fileName}`);
      logger.debug(`Экспортируемые данные для ${name}: ${JSON.stringify(documents.slice(0, 1), null, 2)}`);
    } catch (error) {
      logger.error(`Ошибка при экспорте коллекции ${name}: ${(error as Error).message}`);
    }
  }

  logger.info('Экспорт завершён');
}