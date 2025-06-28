import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
  mongo: {
    uri: process.env.MONGO_URI || '',
    dbName: process.env.DB_NAME || '',
  },
  paths: {
    dataFolder: process.env.DATA_FOLDER || './data',
  },
  batchSize: Number(process.env.BATCH_SIZE) || 1000,
  logger: {
    level: process.env.LOG_LEVEL || 'debug',
    file: process.env.LOG_FILE || 'mongo_script_log.txt',
  },
};