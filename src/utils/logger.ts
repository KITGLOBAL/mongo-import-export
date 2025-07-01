import * as winston from 'winston';
import { config } from '../config.js';
import Transport from 'winston-transport';

class MemoryTransport extends Transport {
  private logBuffer: { level: string, message: string, timestamp: string }[] = [];

  constructor(opts?: Transport.TransportStreamOptions) {
    super(opts);
  }

  log(info: any, callback: () => void) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    const { level, message, timestamp } = info;
    this.logBuffer.push({ level, message, timestamp });

    callback();
  }

  flush() {
    const consoleTransport = new winston.transports.Console({
      format: winston.format.printf(({ level, message, timestamp }) => {
         return `${timestamp} [${level.toUpperCase()}]: ${message}`;
      })
    });
    
    console.log('\n--- Operation Logs ---');
    this.logBuffer.forEach(logEntry => {
        const tempLogger = winston.createLogger({
            levels: winston.config.npm.levels,
            transports: [consoleTransport]
        });
        tempLogger.log(logEntry.level, logEntry.message, { timestamp: logEntry.timestamp });
        tempLogger.close();
    });
    console.log('----------------------\n');
    this.logBuffer = [];
  }
}

const memoryTransport = new MemoryTransport();

export const logger = winston.createLogger({
  level: config.logger.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    memoryTransport,
    new winston.transports.File({ filename: config.logger.file }),
  ],
});

export function flushLogs() {
  memoryTransport.flush();
}