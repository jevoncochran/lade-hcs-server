import { randomInt } from 'node:crypto';

// No 0/O, 1/I/L: references get read out over the phone.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 6;

// Short code customers and staff use on calls, e.g. "LD-7K3Q9X". About 887
// million combinations; a clash is retried by the caller.
export const newBookingReference = () =>
  `LD-${Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;
