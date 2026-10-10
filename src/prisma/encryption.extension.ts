import type { BlindIndex } from '../crypto/blind-index.js';
import type { FieldCipher } from '../crypto/field-cipher.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  BLIND_INDEXES,
  ENCRYPTED_FIELDS,
  RELATIONS,
} from './encrypted-fields.js';

type ModelName = Prisma.ModelName;
type Data = Record<string, unknown>;

const isObject = (value: unknown): value is Data =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  !Buffer.isBuffer(value);

const encryptedFieldsOf = (model: ModelName) => ENCRYPTED_FIELDS[model] ?? [];
const blindIndexesOf = (model: ModelName) => BLIND_INDEXES[model] ?? {};

// Prisma accepts either one object or an array in many write positions.
const mapOneOrMany = (value: unknown, fn: (item: Data) => unknown): unknown =>
  Array.isArray(value)
    ? value.map((item) => fn(item as Data))
    : fn(value as Data);

// ---------- Filters ----------

const RELATION_FILTER_KEYS = ['some', 'every', 'none', 'is', 'isNot'];

// Encrypted values are randomized, so filtering on them silently matches
// nothing. Fail loudly and point at the search hash instead.
const assertFilterable = (model: ModelName, where: unknown): void => {
  if (Array.isArray(where)) {
    where.forEach((item) => assertFilterable(model, item));
    return;
  }
  if (!isObject(where)) return;

  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      assertFilterable(model, value);
    } else if (encryptedFieldsOf(model).includes(key)) {
      const hash = Object.entries(blindIndexesOf(model)).find(
        ([, index]) => index.source === key,
      )?.[0];
      throw new Error(
        `Cannot filter or sort on encrypted field ${model}.${key}` +
          (hash ? `; filter on ${hash} with BlindIndex.hash() instead` : ''),
      );
    } else if (key in RELATIONS[model] && isObject(value)) {
      const target = RELATIONS[model][key];
      const nested = RELATION_FILTER_KEYS.filter((k) => k in value);
      if (nested.length > 0) {
        nested.forEach((k) => assertFilterable(target, value[k]));
      } else {
        assertFilterable(target, value); // to-one shorthand
      }
    }
  }
};

const assertSortable = (model: ModelName, orderBy: unknown): void => {
  for (const item of Array.isArray(orderBy) ? orderBy : [orderBy]) {
    if (!isObject(item)) continue;
    for (const key of Object.keys(item)) {
      if (encryptedFieldsOf(model).includes(key)) {
        assertFilterable(model, { [key]: true });
      }
    }
  }
};

// ---------- Writes ----------

const encryptValue = (
  cipher: FieldCipher,
  field: string,
  value: unknown,
): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return cipher.encrypt(value);
  if (isObject(value) && Object.keys(value).length === 1 && 'set' in value) {
    return { set: encryptValue(cipher, field, value.set) };
  }
  throw new Error(
    `Encrypted field ${field} only supports string values or { set }`,
  );
};

const plaintextOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (isObject(value) && typeof value.set === 'string') return value.set;
  return undefined;
};

type Crypto = { cipher: FieldCipher; blindIndex: BlindIndex };

const encryptNestedWrite = (
  crypto: Crypto,
  target: ModelName,
  op: string,
  arg: unknown,
): unknown => {
  const data = (value: unknown) => encryptData(crypto, target, value as Data);

  switch (op) {
    case 'create':
      return mapOneOrMany(arg as Data, data);
    case 'createMany':
      return {
        ...(arg as Data),
        data: mapOneOrMany((arg as Data).data as Data, data),
      };
    case 'connectOrCreate':
      return mapOneOrMany(arg as Data, (item) => {
        assertFilterable(target, item.where);
        return { ...item, create: data(item.create) };
      });
    case 'update':
    case 'updateMany':
      return mapOneOrMany(arg as Data, (item) => {
        // to-many: { where, data }; to-one: plain data or { where?, data }
        if (!('data' in item)) return data(item);
        assertFilterable(target, item.where);
        return { ...item, data: data(item.data) };
      });
    case 'upsert':
      return mapOneOrMany(arg as Data, (item) => {
        assertFilterable(target, item.where);
        return {
          ...item,
          create: data(item.create),
          update: data(item.update),
        };
      });
    case 'connect':
    case 'disconnect':
    case 'set':
    case 'delete':
    case 'deleteMany':
      assertFilterable(target, arg);
      return arg;
    default:
      throw new Error(`Unsupported nested write "${op}" on ${target}`);
  }
};

// Returns a copy of `data` with encrypted fields encrypted, search hashes
// derived, and nested relation writes handled. Never mutates the input.
const encryptData = (crypto: Crypto, model: ModelName, data: Data): Data => {
  if (!isObject(data)) return data;

  const indexes = blindIndexesOf(model);
  const result: Data = {};

  for (const [key, value] of Object.entries(data)) {
    if (key in indexes) {
      throw new Error(
        `${model}.${key} is derived from ${indexes[key].source}; don't set it directly`,
      );
    } else if (encryptedFieldsOf(model).includes(key)) {
      result[key] = encryptValue(crypto.cipher, `${model}.${key}`, value);
    } else if (key in RELATIONS[model] && isObject(value)) {
      const target = RELATIONS[model][key];
      result[key] = Object.fromEntries(
        Object.entries(value).map(([op, arg]) => [
          op,
          encryptNestedWrite(crypto, target, op, arg),
        ]),
      );
    } else {
      result[key] = value;
    }
  }

  for (const [hashField, { source, kind }] of Object.entries(indexes)) {
    const plaintext = plaintextOf(data[source]);
    if (plaintext !== undefined) {
      result[hashField] = crypto.blindIndex.hash(kind, plaintext);
    }
  }

  return result;
};

// ---------- Reads ----------

// Decrypts encrypted fields in a query result, including included relations.
// Mutates the result in place; Prisma hands us a fresh object.
const decryptResult = (
  cipher: FieldCipher,
  model: ModelName,
  result: unknown,
): unknown => {
  if (Array.isArray(result)) {
    result.forEach((item) => decryptResult(cipher, model, item));
    return result;
  }
  if (!isObject(result)) return result;

  for (const field of encryptedFieldsOf(model)) {
    const value = result[field];
    if (typeof value === 'string') result[field] = cipher.decrypt(value);
  }
  for (const [key, target] of Object.entries(RELATIONS[model])) {
    if (key in result) decryptResult(cipher, target, result[key]);
  }
  return result;
};

// ---------- Extension ----------

// Transparently encrypts PHI on write and decrypts it on read for every model
// operation. Raw SQL ($queryRaw / $executeRaw) bypasses this: never use raw
// SQL to read or write encrypted fields.
export const encryptionExtension = (
  cipher: FieldCipher,
  blindIndex: BlindIndex,
) =>
  Prisma.defineExtension({
    name: 'phi-encryption',
    query: {
      $allModels: {
        async $allOperations({ model, args, query }) {
          const modelName = model as ModelName;
          const crypto = { cipher, blindIndex };
          const next = { ...(args as Data) };

          if ('where' in next) assertFilterable(modelName, next.where);
          if ('orderBy' in next) assertSortable(modelName, next.orderBy);
          if ('data' in next) {
            next.data = mapOneOrMany(next.data as Data, (item) =>
              encryptData(crypto, modelName, item),
            );
          }
          if ('create' in next) {
            next.create = encryptData(crypto, modelName, next.create as Data);
          }
          if ('update' in next) {
            next.update = encryptData(crypto, modelName, next.update as Data);
          }

          const result = await query(next as typeof args);
          return decryptResult(cipher, modelName, result) as typeof result;
        },
      },
    },
  });
