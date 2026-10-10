import { Injectable } from '@nestjs/common';
import { TripKind } from '../generated/prisma/client.js';
import type { QuoteLeg } from '../pricing/pricing.js';
import type { Address } from './address.js';
import {
  AddressNotFoundError,
  DistanceProvider,
  UnknownAddressError,
} from './distance-provider.js';

export type MeasuredLeg = QuoteLeg & { pickup: Address; dropoff: Address };

// Turns a trip's addresses into legs with driving distances, ready for the
// pricing engine. Round trips and wait-and-return trips get a return leg from
// the drop-off back to the pickup, measured separately (one-way streets and
// highway exits can make it a different distance).
@Injectable()
export class MileageService {
  constructor(private readonly distances: DistanceProvider) {}

  async measureTrip(
    tripKind: TripKind,
    pickup: Address,
    dropoff: Address,
  ): Promise<MeasuredLeg[]> {
    const outbound = await this.measureLeg(pickup, dropoff, false);
    if (tripKind === TripKind.ONE_WAY) return [outbound];

    return [outbound, await this.measureLeg(dropoff, pickup, true)];
  }

  private async measureLeg(
    pickup: Address,
    dropoff: Address,
    isReturn: boolean,
  ): Promise<MeasuredLeg> {
    let distanceMeters: number;
    try {
      distanceMeters = await this.distances.drivingDistance(pickup, dropoff);
    } catch (error) {
      if (!(error instanceof UnknownAddressError)) throw error;
      // On the return leg "from" is the trip's drop-off address.
      const fromIsPickup = !isReturn;
      const isTripPickup = (error.which === 'from') === fromIsPickup;
      throw new AddressNotFoundError(isTripPickup ? 'pickup' : 'dropoff');
    }

    return {
      pickup,
      dropoff,
      pickupState: pickup.state.toUpperCase(),
      dropoffState: dropoff.state.toUpperCase(),
      distanceMeters,
    };
  }
}
