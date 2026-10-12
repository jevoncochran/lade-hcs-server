import { Test } from '@nestjs/testing';
import { TripKind } from '../generated/prisma/client.js';
import type { Address } from './address.js';
import {
  AddressNotFoundError,
  DistanceProvider,
  UnknownAddressError,
} from './distance-provider.js';
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
    isEstimate: true,
    drivingDistance: vi.fn<(from: Address, to: Address) => Promise<number>>(
      async (from) => (from === pickup ? 8000 : 8500),
    ),
  };
  let mileage: MileageService;

  beforeEach(async () => {
    distances.drivingDistance.mockReset();
    distances.drivingDistance.mockImplementation(async (from) =>
      from === pickup ? 8000 : 8500,
    );
    const module = await Test.createTestingModule({
      providers: [
        MileageService,
        { provide: DistanceProvider, useValue: distances },
      ],
    }).compile();
    mileage = module.get(MileageService);
  });

  it('passes on whether distances are estimates', () => {
    expect(mileage.distancesAreEstimates).toBe(true);
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

  describe('addresses that cannot be found', () => {
    const failOn = (bad: Address) => async (from: Address, to: Address) => {
      if (from === bad) throw new UnknownAddressError('from');
      if (to === bad) throw new UnknownAddressError('to');
      return 1000;
    };

    it.each([
      ['pickup', pickup],
      ['dropoff', dropoff],
    ] as const)(
      'reports a bad %s address by its role in the trip',
      async (role, bad) => {
        distances.drivingDistance.mockImplementation(failOn(bad));

        for (const tripKind of [TripKind.ONE_WAY, TripKind.ROUND_TRIP]) {
          const error = await mileage
            .measureTrip(tripKind, pickup, dropoff)
            .catch((e: unknown) => e);
          expect(error).toBeInstanceOf(AddressNotFoundError);
          expect((error as AddressNotFoundError).which).toBe(role);
        }
      },
    );

    it('reports the drop-off when only the return leg fails', async () => {
      // The outbound leg works; the drop-off can't be found as a starting point.
      distances.drivingDistance.mockImplementation(async (from: Address) => {
        if (from === dropoff) throw new UnknownAddressError('from');
        return 1000;
      });

      const error = await mileage
        .measureTrip(TripKind.ROUND_TRIP, pickup, dropoff)
        .catch((e: unknown) => e);
      expect((error as AddressNotFoundError).which).toBe('dropoff');
    });

    it('passes other errors through unchanged', async () => {
      distances.drivingDistance.mockRejectedValue(new Error('network down'));

      await expect(
        mileage.measureTrip(TripKind.ONE_WAY, pickup, dropoff),
      ).rejects.toThrow('network down');
    });
  });
});
