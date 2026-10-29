import { GeocodeCommand } from '@aws-sdk/client-geo-places';
import { CalculateRoutesCommand } from '@aws-sdk/client-geo-routes';
import { Logger } from '@nestjs/common';
import type { AwsLocation } from '../../location/aws-location.js';
import type { Address } from '../address.js';
import {
  DistanceUnavailableError,
  UnknownAddressError,
} from '../distance-provider.js';
import { AwsDistanceProvider } from './aws-distance.provider.js';

const address = (line1: string): Address => ({
  line1,
  city: 'Tampa',
  state: 'FL',
  zip: '33603',
});
const HOME = address('123 Palm Ave');
const CLINIC = address('500 Clinic Way');

// A fake AWS client: geocode results keyed by street, one route distance.
const fakeAws = ({
  geocode = {} as Record<string, { PlaceType: string; Position?: number[] }>,
  routeMeters = 5310 as number | null, // null: no driving route
  fail = undefined as Error | undefined,
} = {}) => {
  const places = {
    send: vi.fn(async (command: GeocodeCommand) => {
      if (fail) throw fail;
      const street = command.input.QueryText!.split(',')[0];
      const match = geocode[street];
      return { ResultItems: match ? [match] : [] };
    }),
  };
  const routes = {
    send: vi.fn(async (_command: CalculateRoutesCommand) => ({
      Routes:
        routeMeters === null ? [] : [{ Summary: { Distance: routeMeters } }],
    })),
  };
  return {
    aws: { places, routes } as unknown as AwsLocation,
    places,
    routes,
  };
};

const FOUND = {
  '123 Palm Ave': { PlaceType: 'PointAddress', Position: [-82.47, 27.94] },
  '500 Clinic Way': {
    PlaceType: 'InterpolatedAddress',
    Position: [-82.46, 27.98],
  },
};

describe('AwsDistanceProvider', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('is a real distance, not an estimate', () => {
    expect(new AwsDistanceProvider(fakeAws().aws).isEstimate).toBe(false);
  });

  it('geocodes both addresses and returns the driving route distance', async () => {
    const { aws, places, routes } = fakeAws({
      geocode: FOUND,
      routeMeters: 5310,
    });

    await expect(
      new AwsDistanceProvider(aws).drivingDistance(HOME, CLINIC),
    ).resolves.toBe(5310);

    const geocodeInput = places.send.mock.calls[0][0].input;
    expect(geocodeInput).toMatchObject({
      QueryText: '123 Palm Ave, Tampa, FL 33603',
      Filter: { IncludeCountries: ['USA'] },
      MaxResults: 1,
    });
    expect(routes.send.mock.calls[0][0].input).toEqual({
      Origin: [-82.47, 27.94],
      Destination: [-82.46, 27.98],
      TravelMode: 'Car',
    });
  });

  it.each([
    ['nothing at all', {}],
    [
      'only a city-level match',
      { '123 Palm Ave': { PlaceType: 'Locality', Position: [1, 2] } },
    ],
  ])(
    'reports the pickup as not found when the map finds %s',
    async (_label, pickupMatch) => {
      const { aws } = fakeAws({
        geocode: { ...pickupMatch, '500 Clinic Way': FOUND['500 Clinic Way'] },
      });

      await expect(
        new AwsDistanceProvider(aws).drivingDistance(HOME, CLINIC),
      ).rejects.toEqual(new UnknownAddressError('from'));
    },
  );

  it('reports the drop-off when there is no driving route', async () => {
    const { aws } = fakeAws({ geocode: FOUND, routeMeters: null });

    await expect(
      new AwsDistanceProvider(aws).drivingDistance(HOME, CLINIC),
    ).rejects.toEqual(new UnknownAddressError('to'));
  });

  it('turns AWS failures into "try again", logging no addresses', async () => {
    const logError = vi.spyOn(Logger.prototype, 'error');
    const failure = Object.assign(new Error('Not authenticated.'), {
      name: 'AccessDeniedException',
    });
    const { aws } = fakeAws({ fail: failure });

    await expect(
      new AwsDistanceProvider(aws).drivingDistance(HOME, CLINIC),
    ).rejects.toBeInstanceOf(DistanceUnavailableError);
    expect(logError).toHaveBeenCalledWith(
      'Distance lookup failed: AccessDeniedException',
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain('Palm');
  });
});
