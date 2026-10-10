import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';

const ISSUER = 'Lade HCS';

export const newTotpSecret = () => generateSecret();

// otpauth:// link plus a QR code image (data URL) for authenticator apps.
export const totpEnrollment = async (secret: string, email: string) => {
  const otpauthUrl = generateURI({ issuer: ISSUER, label: email, secret });
  return { otpauthUrl, qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl) };
};

// Returns the matched time step, or null. Allows one 30-second step of clock
// drift either way. `afterTimeStep` rejects a code that was already used, so
// a code seen over someone's shoulder can't be replayed.
export const verifyTotp = async (
  secret: string,
  code: string,
  afterTimeStep?: number | null,
): Promise<number | null> => {
  if (!/^\d{6}$/.test(code)) return null;
  try {
    const result = await verify({
      secret,
      token: code,
      epochTolerance: 30,
      ...(afterTimeStep == null ? {} : { afterTimeStep }),
    });
    return result.valid && 'timeStep' in result ? result.timeStep : null;
  } catch {
    return null;
  }
};
