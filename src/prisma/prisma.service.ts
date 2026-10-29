import { PrismaPg } from '@prisma/adapter-pg';
import type { BlindIndex } from '../crypto/blind-index.js';
import type { FieldCipher } from '../crypto/field-cipher.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { encryptionExtension } from './encryption.extension.js';

export const createPrismaClient = (
  databaseUrl: string,
  cipher: FieldCipher,
  blindIndex: BlindIndex,
) =>
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      // The Postgres adapter sends and reads times without a time zone, so
      // the database session must be UTC. Otherwise a server whose default
      // zone isn't UTC (a local Postgres.app, for example) stores every time
      // shifted by its offset: invisible inside the app, but wrong for the
      // database's own clock, SQL tools and anything comparing them.
      options: '-c TimeZone=UTC',
    }),
  }).$extends(encryptionExtension(cipher, blindIndex));

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

// Injection token for the database client. An extended Prisma client can't be
// subclassed, so this abstract class + interface pair lets services inject
// `PrismaService` by type and get the fully typed, encrypting client:
//
//   constructor(private readonly prisma: PrismaService) {}
//
// Always use this, never `new PrismaClient()`, so PHI is always encrypted.
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
export abstract class PrismaService {}
export interface PrismaService extends ExtendedPrismaClient {}
