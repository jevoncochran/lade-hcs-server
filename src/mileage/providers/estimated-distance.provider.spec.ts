import { METERS_PER_MILE } from '../../pricing/pricing.js';
import type { Address } from '../address.js';
import { EstimatedDistanceProvider } from './estimated-distance.provider.js';

const home: Address = {
  line1: '123 Palm Ave',
  city: 'Tampa',
  state: 'FL',
  zip: '33603',
};
const hospital: Address = {
  line1: '1 Tampa General Cir',
  city: 'Tampa',
  state: 'FL',
  zip: '33606',
};

const toMiles = (meters: number) => meters / METERS_PER_MILE;

describe('EstimatedDistanceProvider', () => {
  const provider = new EstimatedDistanceProvider();

  it('gives the same distance every time for the same addresses', async () => {
    const first = await provider.drivingDistance(home, hospital);

    expect(await provider.drivingDistance(home, hospital)).toBe(first);
  });

  it('is the same in both directions', async () => {
    expect(await provider.drivingDistance(home, hospital)).toBe(
      await provider.drivingDistance(hospital, home),
    );
  });

  it('is 0 for the same address, ignoring case, spacing and line 2', async () => {
    expect(
      await provider.drivingDistance(home, {
        ...home,
        line1: '  123 PALM AVE ',
        line2: 'Apt 4',
        state: 'fl',
      }),
    ).toBe(0);
  });

  it('stays between 2 and 30 miles, to the tenth', async () => {
    for (let i = 0; i < 200; i++) {
      const miles = toMiles(
        await provider.drivingDistance(home, {
          ...hospital,
          line1: `${i} Main St`,
        }),
      );
      expect(miles).toBeGreaterThanOrEqual(2);
      expect(miles).toBeLessThanOrEqual(30);
      expect(Math.round(miles * 10) / 10).toBeCloseTo(miles, 9);
    }
  });

  it('gives different addresses different distances', async () => {
    const distances = new Set<number>();
    for (let i = 0; i < 50; i++) {
      distances.add(
        await provider.drivingDistance(home, {
          ...hospital,
          line1: `${i} Main St`,
        }),
      );
    }
    expect(distances.size).toBeGreaterThan(30);
  });
});
