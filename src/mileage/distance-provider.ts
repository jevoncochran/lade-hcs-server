import type { Address } from './address.js';

// Thrown when a provider can't find an address or a driving route; the
// booking form shows it next to the address fields.
export class AddressNotFoundError extends Error {
  constructor(readonly which: 'pickup' | 'dropoff') {
    super(
      `We couldn't find the ${which} address. Please check it and try again.`,
    );
    this.name = 'AddressNotFoundError';
  }
}

// Injection token for driving distances. Implementations, chosen by
// MILEAGE_PROVIDER:
//   - EstimatedDistanceProvider: development stand-in (no outside calls)
//   - AWS Location Service: production, under the AWS BAA (to be added)
export abstract class DistanceProvider {
  // Driving distance in meters from `from` to `to`.
  abstract drivingDistance(from: Address, to: Address): Promise<number>;
}
