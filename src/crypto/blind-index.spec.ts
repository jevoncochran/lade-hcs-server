import { randomBytes } from 'node:crypto';
import { BlindIndex } from './blind-index.js';

describe('BlindIndex', () => {
  const index = new BlindIndex(randomBytes(32));

  it('matches emails regardless of case and surrounding spaces', () => {
    expect(index.hash('email', '  Mary.Smith@Example.com ')).toBe(
      index.hash('email', 'mary.smith@example.com'),
    );
  });

  it('matches phone numbers in any format, with or without +1', () => {
    const expected = index.hash('phone', '8135550100');
    for (const phone of [
      '(813) 555-0100',
      '813-555-0100',
      '813.555.0100',
      '+1 813 555 0100',
      '1-813-555-0100',
    ]) {
      expect(index.hash('phone', phone)).toBe(expected);
    }
  });

  it('matches names regardless of case and extra spaces', () => {
    expect(index.hash('name', '  mary   SMITH ')).toBe(
      index.hash('name', 'Mary Smith'),
    );
  });

  it('distinguishes different values', () => {
    expect(index.hash('name', 'Mary Smith')).not.toBe(
      index.hash('name', 'Mary Smyth'),
    );
  });

  it('gives the same text different hashes for different kinds', () => {
    expect(index.hash('name', 'mary')).not.toBe(index.hash('email', 'mary'));
  });

  it('depends on the key, so hashes cannot be recomputed without it', () => {
    const other = new BlindIndex(randomBytes(32));

    expect(other.hash('phone', '8135550100')).not.toBe(
      index.hash('phone', '8135550100'),
    );
  });

  it('returns a 64-character hex digest', () => {
    expect(index.hash('email', 'a@b.co')).toMatch(/^[0-9a-f]{64}$/);
  });
});
