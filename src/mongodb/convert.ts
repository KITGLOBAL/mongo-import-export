import { ObjectId } from 'mongodb';
import { logger } from '../utils/logger.js';
import { isValidObjectId, isValidDate } from '../utils/validate.js';

export function convertExtendedJSON(doc: any): any {
  if (Array.isArray(doc)) {
    return doc.map(convertExtendedJSON);
  }
  if (doc !== null && typeof doc === 'object') {
    if (doc['$oid']) {
      logger.debug(`Converting $oid: ${doc['$oid']} to ObjectId`);
      return new ObjectId(doc['$oid']);
    }
    if (doc['$date'] && typeof doc['$date'] === 'object' && doc['$date']['$numberLong']) {
      logger.debug(`Converting $date.$numberLong: ${doc['$date']['$numberLong']} to Date`);
      return new Date(Number(doc['$date']['$numberLong']));
    }
    if (doc['$date'] && typeof doc['$date'] === 'string') {
      logger.debug(`Converting $date: ${doc['$date']} to Date`);
      return new Date(doc['$date']);
    }
    if (doc['$numberInt']) {
      logger.debug(`Converting $numberInt: ${doc['$numberInt']} to Number`);
      return Number(doc['$numberInt']);
    }

    const result: { [key: string]: any } = {};
    for (const [key, value] of Object.entries(doc)) {
      if ((key === '_id' || key === 'theme_id') && typeof value === 'string' && isValidObjectId(value)) {
        logger.debug(`Converting string ${key}: ${value} to ObjectId`);
        result[key] = new ObjectId(value);
      } else if (
        (key === 'createdAt' || key === 'updatedAt' || key === 'last_modified_dt') &&
        typeof value === 'string' &&
        isValidDate(value)
      ) {
        logger.debug(`Converting string ${key}: ${value} to Date`);
        result[key] = new Date(value);
      } else {
        result[key] = convertExtendedJSON(value);
      }
    }
    return result;
  }
  return doc;
}