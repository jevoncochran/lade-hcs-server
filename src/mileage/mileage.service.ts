import { Injectable } from '@nestjs/common';
import { TripKind } from '../generated/prisma/client.js';
import type { QuoteLeg } from '../pricing/pricing.js';
import type { Address } from './address.js';
import { DistanceProvider } from './distance-provider.js';

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
    const outbound = await this.measureLeg(pickup, dropoff);
    if (tripKind === TripKind.ONE_WAY) return [outbound];

    return [outbound, await this.measureLeg(dropoff, pickup)];
  }

  private async measureLeg(
    pickup: Address,
    dropoff: Address,
  ): Promise<MeasuredLeg> {
    return {
      pickup,
      dropoff,
      pickupState: pickup.state.toUpperCase(),
      dropoffState: dropoff.state.toUpperCase(),
      distanceMeters: await this.distances.drivingDistance(pickup, dropoff),
    };
  }
}
