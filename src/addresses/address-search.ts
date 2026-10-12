import type { Address } from '../mileage/address.js';

export type AddressSuggestion = {
  placeId: string;
  label: string; // e.g. "3008 N Nebraska Ave, Tampa, FL 33603, United States"
};

// Injection token for address autofill on the booking form. Implementations:
//   - AwsAddressSearch: Amazon Location Service Places (MILEAGE_PROVIDER=aws)
//   - NoAddressSearch: no suggestions (the estimate stand-in); customers just
//     type the address
//
// What people type here is PHI once tied to a ride: only send it to
// providers covered by a BAA, and never log it.
export abstract class AddressSearch {
  abstract readonly available: boolean;

  abstract suggest(query: string): Promise<AddressSuggestion[]>;

  // The full address for a chosen suggestion, ready to fill in the form.
  // Null if the place isn't a usable US street address.
  abstract lookup(placeId: string): Promise<Address | null>;
}
