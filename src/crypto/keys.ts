// Parsing and checks for the encryption and blind-index keys.
//
// ENCRYPTION_KEYS holds every key that may still be needed to decrypt old
// data, as comma-separated `id:base64` pairs, e.g. "k1:AbC...=,k2:XyZ...=".
// ENCRYPTION_ACTIVE_KEY_ID picks the one used for new writes. To rotate, add a
// new key, switch the active id, and keep the old key until a re-encryption
// job has rewritten every row.
//
// BLIND_INDEX_KEY is a separate key for the search hashes. It can never be
// rotated without recomputing every hash, so treat it as permanent.
//
// Losing these keys makes all patient data permanently unreadable. Production
// keys must be backed up outside Google Cloud (see docs/plan.md).

export const KEY_BYTES = 32; // AES-256 / HMAC-SHA256
export const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;

export type Keyring = Map<string, Buffer>;

export const decodeKey = (base64: string): Buffer => {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES || key.toString('base64') !== base64) {
    throw new Error(`must be ${KEY_BYTES} bytes encoded as base64`);
  }
  return key;
};

export const parseKeyring = (raw: string): Keyring => {
  const keyring: Keyring = new Map();

  for (const entry of raw.split(',').map((part) => part.trim())) {
    const separator = entry.indexOf(':');
    if (separator === -1) {
      throw new Error('entries must look like "id:base64key"');
    }
    const id = entry.slice(0, separator);
    if (!KEY_ID_PATTERN.test(id)) {
      throw new Error(`key id "${id}" must be 1-16 letters, digits, _ or -`);
    }
    if (keyring.has(id)) {
      throw new Error(`key id "${id}" is listed twice`);
    }
    try {
      keyring.set(id, decodeKey(entry.slice(separator + 1)));
    } catch (error) {
      throw new Error(`key "${id}" ${(error as Error).message}`);
    }
  }

  return keyring;
};

export type CryptoSettings = {
  ENCRYPTION_KEYS: string;
  ENCRYPTION_ACTIVE_KEY_ID: string;
  BLIND_INDEX_KEY: string;
};

// Returns a list of problems (empty when valid), for config validation.
export const checkCryptoSettings = (settings: CryptoSettings): string[] => {
  const problems: string[] = [];

  let keyring: Keyring | undefined;
  try {
    keyring = parseKeyring(settings.ENCRYPTION_KEYS);
  } catch (error) {
    problems.push(`ENCRYPTION_KEYS: ${(error as Error).message}`);
  }

  if (keyring && !keyring.has(settings.ENCRYPTION_ACTIVE_KEY_ID)) {
    problems.push(
      `ENCRYPTION_ACTIVE_KEY_ID "${settings.ENCRYPTION_ACTIVE_KEY_ID}" is not one of the ids in ENCRYPTION_KEYS`,
    );
  }

  let blindIndexKey: Buffer | undefined;
  try {
    blindIndexKey = decodeKey(settings.BLIND_INDEX_KEY);
  } catch (error) {
    problems.push(`BLIND_INDEX_KEY ${(error as Error).message}`);
  }

  if (
    keyring &&
    blindIndexKey &&
    [...keyring.values()].some((key) => key.equals(blindIndexKey))
  ) {
    problems.push(
      'BLIND_INDEX_KEY must be different from every encryption key',
    );
  }

  return problems;
};
