import { Injectable } from '@nestjs/common';
import { METERS_PER_MILE } from '../../pricing/pricing.js';
import { normalizeAddress, type Address } from '../address.js';
import { FL_ZIP_CENTROIDS } from '../data/fl-zip-centroids.js';
import { DistanceProvider, UnknownAddressError } from '../distance-provider.js';

const EARTH_RADIUS_MILES = 3958.8;

// Roads are longer than a straight line. 1.3 is a typical factor for city
// and suburban driving.
export const ROAD_FACTOR = 1.3;

// Two different addresses in the same ZIP code are still a real trip.
export const SAME_ZIP_MIN_MILES = 1;

// DEVELOPMENT STAND-IN for AWS Location Service. Estimates the driving
// distance from ZIP codes alone: the straight-line distance between the two
// ZIP codes' center points (US Census data), times a road factor. Runs
// offline, so no address ever leaves the server.
//
// Accurate to the ZIP code, not the street: good enough to make test prices
// believable, never for real billing. Quotes made with it are flagged
// `distanceIsEstimate`, and config validation refuses it in production.
@Injectable()
export class EstimatedDistanceProvider extends DistanceProvider {
  readonly isEstimate = true;

  async drivingDistance(from: Address, to: Address): Promise<number> {
    if (normalizeAddress(from) === normalizeAddress(to)) return 0;

    const start = centroidOf(from);
    const end = centroidOf(to);
    if (!start) throw new UnknownAddressError('from');
    if (!end) throw new UnknownAddressError('to');

    const miles = Math.max(
      straightLineMiles(start, end) * ROAD_FACTOR,
      SAME_ZIP_MIN_MILES,
    );
    return miles * METERS_PER_MILE;
  }
}

const centroidOf = (address: Address) =>
  FL_ZIP_CENTROIDS[address.zip.slice(0, 5)];

// Great-circle ("as the crow flies") distance between two points.
export const straightLineMiles = (
  [lat1, lon1]: readonly [number, number],
  [lat2, lon2]: readonly [number, number],
) => {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
};
