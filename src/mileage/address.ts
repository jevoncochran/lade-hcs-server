// A US street address as entered on the booking form. Addresses of rides to
// medical appointments are PHI: never log them, and only send them to
// providers covered by a BAA (AWS Location Service).
export type Address = {
  line1: string;
  line2?: string;
  city: string;
  state: string; // two-letter code, e.g. "FL"
  zip: string; // 5 digits, or ZIP+4
};

// One line, for map lookups: "5100 N Nebraska Ave, Tampa, FL 33603".
// Line 2 (apartment, suite) doesn't affect driving distance, so it's left out.
export const formatAddress = (address: Address) =>
  `${address.line1}, ${address.city}, ${address.state.toUpperCase()} ${address.zip}`;

// For comparing addresses: case, spacing and punctuation don't matter.
export const normalizeAddress = (address: Address) =>
  formatAddress(address)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
