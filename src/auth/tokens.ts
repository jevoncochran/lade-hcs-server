import { createHash, randomBytes } from 'node:crypto';

// Random tokens for session cookies and one-time links. Only the SHA-256 hash
// is stored, so a database leak doesn't hand out working sessions or links.
// (Plain SHA-256 is fine here: the tokens are 256-bit random, not guessable.)
export const newToken = () => randomBytes(32).toString('base64url');

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
