import { METERS_PER_MILE } from '../../pricing/pricing.js';
import type { Address } from '../address.js';
import { UnknownAddressError } from '../distance-provider.js';
import {
  EstimatedDistanceProvider,
  ROAD_FACTOR,
  straightLineMiles,
} from './estimated-distance.provider.js';

const address = (line1: string, zip: string): Address => ({
  line1,
  city: 'Tampa',
  state: 'FL',
  zip,
});

const TAMPA_GENERAL = address('1 Tampa General Cir', '33606');
const NEBRASKA_AVE = address('3008 N Nebraska Ave', '33603');

describe('EstimatedDistanceProvider', () => {
  const provider = new EstimatedDistanceProvider();
  const miles = async (from: Address, to: Address) =>
    (await provider.drivingDistance(from, to)) / METERS_PER_MILE;

  it('says it is an estimate', () => {
    expect(provider.isEstimate).toBe(true);
  });

  it('estimates Tampa General → N Nebraska Ave close to the real ~3.3 mi', async () => {
    // Was 28.7 mi with the old made-up stand-in.
    const estimate = await miles(TAMPA_GENERAL, NEBRASKA_AVE);

    expect(estimate).toBeGreaterThan(3);
    expect(estimate).toBeLessThan(4.5);
  });

  it('is straight-line distance between ZIP centers times the road factor', async () => {
    const straight = straightLineMiles([27.944, -82.474], [27.9856, -82.4644]);

    expect(await miles(TAMPA_GENERAL, NEBRASKA_AVE)).toBeCloseTo(
      straight * ROAD_FACTOR,
      2,
    );
  });

  it('gives sensible long distances (Tampa → Miami is roughly 200+ mi)', async () => {
    const estimate = await miles(
      address('100 S Ashley Dr', '33602'),
      address('100 Biscayne Blvd', '33132'),
    );

    expect(estimate).toBeGreaterThan(200);
    expect(estimate).toBeLessThan(330);
  });

  it('is the same in both directions', async () => {
    expect(await miles(TAMPA_GENERAL, NEBRASKA_AVE)).toBe(
      await miles(NEBRASKA_AVE, TAMPA_GENERAL),
    );
  });

  it('counts different addresses in the same ZIP as at least 1 mile', async () => {
    expect(
      await miles(
        address('1 Main St', '33603'),
        address('900 Main St', '33603'),
      ),
    ).toBe(1);
  });

  it('is 0 for the same address, ignoring case, spacing and line 2', async () => {
    expect(
      await miles(NEBRASKA_AVE, {
        ...NEBRASKA_AVE,
        line1: '  3008 n NEBRASKA ave ',
        line2: 'Apt 4',
      }),
    ).toBe(0);
  });

  it('accepts ZIP+4', async () => {
    expect(
      await miles(TAMPA_GENERAL, { ...NEBRASKA_AVE, zip: '33603-1234' }),
    ).toBe(await miles(TAMPA_GENERAL, NEBRASKA_AVE));
  });

  it('reports a ZIP code it does not know as an unknown address', async () => {
    await expect(
      provider.drivingDistance(address('1 Nowhere', '99999'), NEBRASKA_AVE),
    ).rejects.toEqual(new UnknownAddressError('from'));
    await expect(
      provider.drivingDistance(
        TAMPA_GENERAL,
        address('1 Peachtree St', '30303'),
      ),
    ).rejects.toEqual(new UnknownAddressError('to'));
  });
});
