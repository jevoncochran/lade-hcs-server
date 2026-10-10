import { Test } from '@nestjs/testing';
import { TripKind } from '../generated/prisma/client.js';
import type { Address } from './address.js';
import { DistanceProvider } from './distance-provider.js';
import { MileageService } from './mileage.service.js';

const pickup: Address = {
  line1: '123 Palm Ave',
  city: 'Tampa',
  state: 'fl',
  zip: '33603',
};
const dropoff: Address = {
  line1: '1 Tampa General Cir',
  city: 'Tampa',
  state: 'FL',
  zip: '33606',
};

describe('MileageService', () => {
  // Different distances each way, to prove legs are measured separately.
  const distances = {
    drivingDistance: vi.fn(async (from: Address) =>
      from === pickup ? 8000 : 8500,
    ),
  };
  let mileage: MileageService;

  beforeEach(async () => {
    distances.drivingDistance.mockClear();
    const module = await Test.createTestingModule({
      providers: [
        MileageService,
        { provide: DistanceProvider, useValue: distances },
      ],
    }).compile();
    mileage = module.get(MileageService);
  });

  it('measures one leg for a one-way trip', async () => {
    const legs = await mileage.measureTrip(TripKind.ONE_WAY, pickup, dropoff);

    expect(legs).toEqual([
      {
        pickup,
        dropoff,
        pickupState: 'FL',
        dropoffState: 'FL',
        distanceMeters: 8000,
      },
    ]);
    expect(distances.drivingDistance).toHaveBeenCalledTimes(1);
  });

  it.each([TripKind.ROUND_TRIP, TripKind.WAIT_AND_RETURN])(
    'measures the return leg separately for %s',
    async (tripKind) => {
      const legs = await mileage.measureTrip(tripKind, pickup, dropoff);

      expect(
        legs.map((leg) => [leg.pickup, leg.dropoff, leg.distanceMeters]),
      ).toEqual([
        [pickup, dropoff, 8000],
        [dropoff, pickup, 8500],
      ]);
      expect(distances.drivingDistance).toHaveBeenCalledWith(dropoff, pickup);
    },
  );
});
