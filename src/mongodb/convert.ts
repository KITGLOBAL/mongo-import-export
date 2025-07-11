import { ObjectId, Document } from 'mongodb';
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
      if (typeof value === 'string') {
        if (key === '_id' && isValidObjectId(value)) {
          result[key] = new ObjectId(value);
        } else if (isValidDate(value)) {
          result[key] = new Date(value);
        } else {
          result[key] = value;
        }
      } else {
        result[key] = convertExtendedJSON(value);
      }
    }
    return result;
  }
  return doc;
}

export function convertCSVRow(row: { [key: string]: any }): Document {
  const result: Document = {};
  for (let [key, value] of Object.entries(row)) {
    if (value === null || value === '') {
      result[key] = value;
      continue;
    }
    const stringValue = String(value);
    if (key === '_id' && isValidObjectId(stringValue)) {
        result[key] = new ObjectId(stringValue);
        continue;
    }
    if ((key.endsWith('At') || key.endsWith('Dt')) && isValidDate(stringValue)) {
        result[key] = new Date(stringValue);
        continue;
    }
    if (isValidObjectId(stringValue)) {
      result[key] = new ObjectId(stringValue);
    } else if (isValidDate(stringValue)) {
        result[key] = new Date(stringValue);
    } else if (!isNaN(Number(stringValue)) && stringValue.trim() !== '') {
        result[key] = Number(stringValue);
    } else if (stringValue.toLowerCase() === 'true' || stringValue.toLowerCase() === 'false') {
        result[key] = (stringValue.toLowerCase() === 'true');
    } else {
      try {
        const parsed = JSON.parse(stringValue);
        result[key] = convertExtendedJSON(parsed);
      } catch (e) {
        result[key] = stringValue;
      }
    }
  }
  return result;
}

/**
 * @param documents
 * @returns
 */
export function prepareForCSVExport(documents: Document[]): Document[] {
  return documents.map(doc => {
    const newDoc: Document = {};
    for (const key in doc) {
      const value = doc[key];
      if (value instanceof ObjectId) {
        newDoc[key] = value.toHexString();
      } else if (value instanceof Date) {
        newDoc[key] = value.toISOString();
      } else if (typeof value === 'object' && value !== null) {
        newDoc[key] = JSON.stringify(value);
      } else {
        newDoc[key] = value;
      }
    }
    return newDoc;
  });
}

/**
 * 
 * @param doc
 * @returns
 */
export function prepareForJSONExport(doc: any): any {
  if (Array.isArray(doc)) {
    return doc.map(prepareForJSONExport);
  }
  if (doc instanceof ObjectId) {
    return { $oid: doc.toHexString() };
  }
  if (doc instanceof Date) {
    return { $date: doc.toISOString() };
  }
  if (doc !== null && typeof doc === 'object') {
    const result: { [key: string]: any } = {};
    for (const [key, value] of Object.entries(doc)) {
      result[key] = prepareForJSONExport(value);
    }
    return result;
  }
  return doc;
}