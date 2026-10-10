import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Keyring } from './keys.js';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12; // standard GCM nonce size
const TAG_BYTES = 16;

// Stored format: v1:<keyId>:<iv>:<authTag>:<ciphertext>, parts base64url.
// The key id lets old rows decrypt after the active key changes. A fresh
// random IV per value means equal plaintexts never produce equal ciphertexts.
// The GCM auth tag makes any tampering fail loudly instead of decrypting to
// garbage.
export class FieldCipher {
  constructor(
    private readonly keyring: Keyring,
    private readonly activeKeyId: string,
  ) {
    if (!keyring.has(activeKeyId)) {
      throw new Error(`Active key "${activeKeyId}" is not in the keyring`);
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(
      ALGORITHM,
      this.keyring.get(this.activeKeyId)!,
      iv,
    );
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return [
      VERSION,
      this.activeKeyId,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  decrypt(stored: string): string {
    const parts = stored.split(':');
    if (parts.length !== 5 || parts[0] !== VERSION) {
      // Never pass through unencrypted values: if one shows up, something
      // wrote PHI around the encryption layer and we want to know.
      throw new Error('Value is not in the encrypted field format');
    }

    const [, keyId, iv, tag, ciphertext] = parts;
    const key = this.keyring.get(keyId);
    if (!key) {
      throw new Error(`No key "${keyId}" in the keyring to decrypt this value`);
    }

    const authTag = Buffer.from(tag, 'base64url');
    if (authTag.length !== TAG_BYTES) {
      throw new Error('Encrypted value has an invalid auth tag');
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(authTag);

    try {
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error(
        'Encrypted value failed authentication (tampered or wrong key)',
      );
    }
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(`${VERSION}:`) && value.split(':').length === 5;
  }
}
