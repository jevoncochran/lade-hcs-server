import type { Address } from './address.js';

// Thrown by a provider that can't find one of the two addresses it was given.
export class UnknownAddressError extends Error {
  constructor(readonly which: 'from' | 'to') {
    super(`Address not found (${which})`);
    this.name = 'UnknownAddressError';
  }
}

// What callers see: which of the trip's addresses couldn't be found, so the
// booking form can point at it. Never includes the address itself (PHI).
export class AddressNotFoundError extends Error {
  constructor(readonly which: 'pickup' | 'dropoff') {
    super(
      `We couldn't find the ${which === 'pickup' ? 'pickup' : 'drop-off'} address. Please check it and try again.`,
    );
    this.name = 'AddressNotFoundError';
  }
}

// Injection token for driving distances. Implementations, chosen by
// MILEAGE_PROVIDER:
//   - EstimatedDistanceProvider: development stand-in (no outside calls)
//   - AWS Location Service: production, under the AWS BAA (to be added)
export abstract class DistanceProvider {
  // Driving distance in meters from `from` to `to`. Throws
  // UnknownAddressError if either address can't be found.
  abstract drivingDistance(from: Address, to: Address): Promise<number>;
}
