import { randomBytes } from 'node:crypto';
import { checkCryptoSettings, parseKeyring } from './keys.js';

const key = () => randomBytes(32).toString('base64');

describe('parseKeyring', () => {
  it('parses one or more id:key pairs', () => {
    const keyring = parseKeyring(`k1:${key()}, k2:${key()}`);

    expect([...keyring.keys()]).toEqual(['k1', 'k2']);
    expect(keyring.get('k1')).toHaveLength(32);
  });

  it('rejects entries without an id', () => {
    expect(() => parseKeyring(key())).toThrow(/id:base64key/);
  });

  it('rejects keys of the wrong length', () => {
    const short = randomBytes(16).toString('base64');

    expect(() => parseKeyring(`k1:${short}`)).toThrow(/must be 32 bytes/);
  });

  it('rejects text that is not base64', () => {
    expect(() => parseKeyring('k1:REPLACE_ME')).toThrow(/must be 32 bytes/);
  });

  it('rejects duplicate ids', () => {
    expect(() => parseKeyring(`k1:${key()},k1:${key()}`)).toThrow(
      /listed twice/,
    );
  });
});

describe('checkCryptoSettings', () => {
  const valid = () => ({
    ENCRYPTION_KEYS: `k1:${key()}`,
    ENCRYPTION_ACTIVE_KEY_ID: 'k1',
    BLIND_INDEX_KEY: key(),
  });

  it('accepts valid settings', () => {
    expect(checkCryptoSettings(valid())).toEqual([]);
  });

  it('requires the active id to exist', () => {
    expect(
      checkCryptoSettings({ ...valid(), ENCRYPTION_ACTIVE_KEY_ID: 'k2' }),
    ).toEqual([expect.stringMatching(/"k2" is not one of the ids/)]);
  });

  it('requires a separate blind index key', () => {
    const shared = key();

    expect(
      checkCryptoSettings({
        ENCRYPTION_KEYS: `k1:${shared}`,
        ENCRYPTION_ACTIVE_KEY_ID: 'k1',
        BLIND_INDEX_KEY: shared,
      }),
    ).toEqual([expect.stringMatching(/must be different/)]);
  });

  it('never includes key material in messages', () => {
    const settings = {
      ...valid(),
      BLIND_INDEX_KEY: randomBytes(16).toString('base64'),
    };
    const messages = checkCryptoSettings(settings).join('\n');

    expect(messages).not.toContain(settings.BLIND_INDEX_KEY);
    expect(messages).not.toContain(settings.ENCRYPTION_KEYS.slice(3));
  });
});
