import { readFileSync } from 'node:fs';
import {
  BLIND_INDEXES,
  ENCRYPTED_FIELDS,
  RELATIONS,
} from './encrypted-fields.js';

// Reads prisma/schema.prisma directly so the encryption config can never
// drift from the schema: marking a field `/// @encrypted` (or adding a
// relation) without updating encrypted-fields.ts fails here.
type SchemaField = { name: string; type: string; encrypted: boolean };

const parseSchema = () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const models = new Map<string, SchemaField[]>();

  for (const [, name, body] of schema.matchAll(
    /^model (\w+) \{([\s\S]*?)^\}/gm,
  )) {
    const fields = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^\w+\s+\w/.test(line) && !line.startsWith('@@'))
      .map((line) => {
        const [fieldName, rawType] = line.split(/\s+/);
        return {
          name: fieldName,
          type: rawType.replace(/[?[\]]/g, ''),
          encrypted: line.includes('/// @encrypted'),
        };
      });
    models.set(name, fields);
  }
  return models;
};

const models = parseSchema();

describe('encrypted field config', () => {
  it('lists exactly the fields marked /// @encrypted', () => {
    const fromSchema = Object.fromEntries(
      [...models]
        .map(
          ([model, fields]) =>
            [
              model,
              fields.filter((f) => f.encrypted).map((f) => f.name),
            ] as const,
        )
        .filter(([, fields]) => fields.length > 0),
    );

    expect(ENCRYPTED_FIELDS).toEqual(fromSchema);
  });

  it('stores every encrypted field as a String column', () => {
    for (const [model, fields] of models) {
      for (const field of fields.filter((f) => f.encrypted)) {
        expect(`${model}.${field.name}: ${field.type}`).toBe(
          `${model}.${field.name}: String`,
        );
      }
    }
  });

  it('lists every relation in the schema', () => {
    const fromSchema = Object.fromEntries(
      [...models].map(([model, fields]) => [
        model,
        Object.fromEntries(
          fields.filter((f) => models.has(f.type)).map((f) => [f.name, f.type]),
        ),
      ]),
    );

    expect(RELATIONS).toEqual(fromSchema);
  });

  it('derives search hashes only from encrypted fields that exist', () => {
    for (const [model, indexes] of Object.entries(BLIND_INDEXES)) {
      const fields = models.get(model)!.map((f) => f.name);
      for (const [hashField, { source }] of Object.entries(indexes)) {
        expect(fields).toContain(hashField);
        expect(
          ENCRYPTED_FIELDS[model as keyof typeof ENCRYPTED_FIELDS],
        ).toContain(source);
      }
    }
  });
});
