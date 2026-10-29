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

// The map service couldn't be reached or refused the request. Not the
// customer's fault: the booking form asks them to try again or call.
export class DistanceUnavailableError extends Error {
  constructor() {
    super(
      "We couldn't calculate the distance right now. Please try again in a minute, or call us to book.",
    );
    this.name = 'DistanceUnavailableError';
  }
}

// Injection token for driving distances. Implementations, chosen by
// MILEAGE_PROVIDER:
//   - EstimatedDistanceProvider: development stand-in, from ZIP codes only
//   - AwsDistanceProvider: Amazon Location Service (production, under the
//     AWS BAA)
export abstract class DistanceProvider {
  // True for stand-ins that don't measure the real route. Quotes and
  // bookings carry this so the website can label the distance.
  abstract readonly isEstimate: boolean;

  // Driving distance in meters from `from` to `to`. Throws
  // UnknownAddressError if either address can't be found.
  abstract drivingDistance(from: Address, to: Address): Promise<number>;
}
