import { randomBytes } from 'node:crypto';
import { FieldCipher } from './field-cipher.js';

const newKey = () => randomBytes(32);

describe('FieldCipher', () => {
  const k1 = newKey();
  const cipher = new FieldCipher(new Map([['k1', k1]]), 'k1');

  it('round-trips plaintext', () => {
    expect(cipher.decrypt(cipher.encrypt('Mary Smith'))).toBe('Mary Smith');
  });

  it('round-trips accents, emoji, JSON and empty strings', () => {
    for (const value of [
      'José Peña',
      'needs help 🦽',
      JSON.stringify({ line1: '5100 N Nebraska Ave', zip: '33603' }),
      '',
    ]) {
      expect(cipher.decrypt(cipher.encrypt(value))).toBe(value);
    }
  });

  it('stores nothing readable and tags the key id', () => {
    const stored = cipher.encrypt('Mary Smith');

    expect(stored).not.toContain('Mary');
    expect(stored).toMatch(/^v1:k1:[\w-]+:[\w-]+:[\w-]*$/);
  });

  it('produces different ciphertext for the same plaintext', () => {
    expect(cipher.encrypt('Mary Smith')).not.toBe(cipher.encrypt('Mary Smith'));
  });

  it('rejects tampered ciphertext', () => {
    const [v, id, iv, tag, data] = cipher.encrypt('Mary Smith').split(':');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    const tampered = [v, id, iv, tag, flipped.toString('base64url')].join(':');

    expect(() => cipher.decrypt(tampered)).toThrow(/failed authentication/);
  });

  it('rejects a value encrypted under a different key with the same id', () => {
    const other = new FieldCipher(new Map([['k1', newKey()]]), 'k1');

    expect(() => cipher.decrypt(other.encrypt('Mary Smith'))).toThrow(
      /failed authentication/,
    );
  });

  it('refuses to pass through unencrypted values', () => {
    expect(() => cipher.decrypt('Mary Smith')).toThrow(/not in the encrypted/);
  });

  it('still decrypts old data after the active key rotates', () => {
    const before = new FieldCipher(new Map([['k1', k1]]), 'k1');
    const oldValue = before.encrypt('Mary Smith');

    const rotated = new FieldCipher(
      new Map([
        ['k1', k1],
        ['k2', newKey()],
      ]),
      'k2',
    );

    expect(rotated.decrypt(oldValue)).toBe('Mary Smith');
    expect(rotated.encrypt('new').startsWith('v1:k2:')).toBe(true);
  });

  it('reports a missing key id clearly', () => {
    const onlyK2 = new FieldCipher(new Map([['k2', newKey()]]), 'k2');

    expect(() => onlyK2.decrypt(cipher.encrypt('x'))).toThrow(/No key "k1"/);
  });

  it('requires the active key to be in the keyring', () => {
    expect(() => new FieldCipher(new Map([['k1', k1]]), 'k9')).toThrow(
      /Active key "k9"/,
    );
  });
});
