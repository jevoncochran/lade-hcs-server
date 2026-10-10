import { hash, verify, type Algorithm } from '@node-rs/argon2';

// argon2id with OWASP's recommended minimum (19 MiB memory, 2 passes, 1 lane).
const OPTIONS = {
  // Algorithm is a const enum (unusable with isolatedModules); 2 = Argon2id.
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export const PASSWORD_MIN_LENGTH = 8;
// Upper bound so a huge "password" can't tie up the CPU.
export const PASSWORD_MAX_LENGTH = 128;

export const hashPassword = (password: string) => hash(password, OPTIONS);

export const verifyPassword = async (
  passwordHash: string,
  password: string,
) => {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false; // malformed hash
  }
};

// Verified against when no account matches, so "no such email" takes as long
// as "wrong password" and response timing doesn't reveal who has an account.
let dummyHash: Promise<string> | undefined;
export const burnPasswordCheck = async (password: string) => {
  dummyHash ??= hashPassword('not-a-real-password-just-for-timing');
  await verifyPassword(await dummyHash, password);
};
