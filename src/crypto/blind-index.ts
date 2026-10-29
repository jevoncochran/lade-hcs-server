import { createHmac } from 'node:crypto';

export type BlindIndexKind = 'email' | 'phone' | 'name';

// Values are normalized before hashing so that different spellings of the
// same thing produce the same hash.
const normalizers: Record<BlindIndexKind, (value: string) => string> = {
  email: (value) => value.trim().toLowerCase(),
  // Digits only; a leading US country code is dropped so "+1 (813) 555-0100"
  // and "813-555-0100" match.
  phone: (value) => {
    const digits = value.replace(/\D/g, '');
    return digits.length === 11 && digits.startsWith('1')
      ? digits.slice(1)
      : digits;
  },
  name: (value) =>
    value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(),
};

// Keyed hashes (HMAC-SHA256) that let staff find a booking by exact email,
// phone or name without those values being readable in the database. Without
// the key, the hashes can't be reversed or brute-forced (phone numbers alone
// would be easy to guess with a plain hash). Exact match only: no partial or
// fuzzy search.
export class BlindIndex {
  constructor(private readonly key: Buffer) {}

  hash(kind: BlindIndexKind, value: string): string {
    // The kind is part of the input so an email and a name with the same
    // text never share a hash.
    return createHmac('sha256', this.key)
      .update(`${kind}:${normalizers[kind](value)}`)
      .digest('hex');
  }
}
