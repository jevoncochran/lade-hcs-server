import { randomBytes } from 'node:crypto';

// Prints a fresh set of encryption settings for a .env file.
//
// For local development and tests only. Production keys are generated once,
// stored in Google Secret Manager, and backed up outside Google Cloud. Losing
// them makes all patient data permanently unreadable.
const key = () => randomBytes(32).toString('base64');

console.log(`ENCRYPTION_KEYS=k1:${key()}`);
console.log('ENCRYPTION_ACTIVE_KEY_ID=k1');
console.log(`BLIND_INDEX_KEY=${key()}`);
