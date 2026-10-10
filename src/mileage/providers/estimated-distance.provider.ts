import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { normalizeAddress, type Address } from '../address.js';
import { DistanceProvider } from '../distance-provider.js';
import { METERS_PER_MILE } from '../../pricing/pricing.js';

const MIN_MILES = 2;
const MAX_MILES = 30;

// DEVELOPMENT STAND-IN. Makes up a distance instead of looking up the real
// route, so booking can be built and tested before Lade's AWS account exists.
// Config validation refuses to start production with it.
//
// The made-up distances are consistent, which keeps quotes predictable while
// testing: the same two addresses always give the same distance, A→B equals
// B→A (so round trips are symmetric), and the same address gives 0. Values
// fall between 2 and 30 miles, to the tenth.
@Injectable()
export class EstimatedDistanceProvider extends DistanceProvider {
  async drivingDistance(from: Address, to: Address): Promise<number> {
    const [a, b] = [normalizeAddress(from), normalizeAddress(to)].sort();
    if (a === b) return 0;

    const hash = createHash('sha256').update(`${a}|${b}`).digest();
    const tenths =
      MIN_MILES * 10 +
      (hash.readUInt32BE(0) % ((MAX_MILES - MIN_MILES) * 10 + 1));
    return (tenths / 10) * METERS_PER_MILE;
  }
}
