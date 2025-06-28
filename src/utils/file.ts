import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from './logger.js';
import { config } from '../config.js';

export async function ensureFolderExists(): Promise<void> {
  try {
    await fs.access(config.paths.dataFolder);
  } catch {
    await fs.mkdir(config.paths.dataFolder, { recursive: true });
    logger.info(`Created folder: ${config.paths.dataFolder}`);
  }
}

export async function clearFolder(): Promise<void> {
  try {
    const files = await fs.readdir(config.paths.dataFolder);
    for (const file of files) {
      await fs.unlink(path.join(config.paths.dataFolder, file));
    }
    logger.info(`Folder ${config.paths.dataFolder} cleared`);
  } catch (error) {
    logger.warn(`Error clearing folder ${config.paths.dataFolder}: ${(error as Error).message}`);
  }
}