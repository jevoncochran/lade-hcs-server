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
    adapter: new PrismaPg({ connectionString: databaseUrl }),
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
