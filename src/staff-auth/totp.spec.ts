import { generate } from 'otplib';
import { newTotpSecret, totpEnrollment, verifyTotp } from './totp.js';

const codeAt = (secret: string, offsetSeconds = 0) =>
  generate({ secret, epoch: Math.floor(Date.now() / 1000) + offsetSeconds });

describe('TOTP', () => {
  const secret = newTotpSecret();

  it('accepts the current code and returns its time step', async () => {
    const step = await verifyTotp(secret, await codeAt(secret));
    const nowStep = Math.floor(Date.now() / 1000 / 30);

    // Within one step: the clock may tick over between the two lines above.
    expect(Math.abs(step! - nowStep)).toBeLessThanOrEqual(1);
  });

  it('tolerates one step of clock drift', async () => {
    expect(await verifyTotp(secret, await codeAt(secret, -30))).not.toBeNull();
    expect(await verifyTotp(secret, await codeAt(secret, 30))).not.toBeNull();
  });

  it('rejects codes from further away', async () => {
    expect(await verifyTotp(secret, await codeAt(secret, 120))).toBeNull();
  });

  it('rejects a code that was already used', async () => {
    const code = await codeAt(secret);
    const step = await verifyTotp(secret, code);

    expect(await verifyTotp(secret, code, step)).toBeNull();
  });

  it('rejects malformed codes and other secrets', async () => {
    expect(await verifyTotp(secret, '12345')).toBeNull();
    expect(await verifyTotp(secret, 'abcdef')).toBeNull();
    expect(await verifyTotp(newTotpSecret(), await codeAt(secret))).toBeNull();
  });

  it('builds an otpauth link and QR code for the app', async () => {
    const { otpauthUrl, qrCodeDataUrl } = await totpEnrollment(
      secret,
      'owner@ladehcs.com',
    );

    expect(otpauthUrl).toMatch(
      /^otpauth:\/\/totp\/Lade%20HCS:owner%40ladehcs\.com\?/,
    );
    expect(otpauthUrl).toContain(`secret=${secret}`);
    expect(qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
