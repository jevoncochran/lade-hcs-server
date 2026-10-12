import { GeocodeCommand } from '@aws-sdk/client-geo-places';
import { CalculateRoutesCommand } from '@aws-sdk/client-geo-routes';
import { Logger } from '@nestjs/common';
import {
  STREET_LEVEL_PLACE_TYPES,
  TAMPA_POSITION,
  type AwsLocation,
} from '../../location/aws-location.js';
import { formatAddress, type Address } from '../address.js';
import {
  DistanceProvider,
  DistanceUnavailableError,
  UnknownAddressError,
} from '../distance-provider.js';

// Real driving distances from Amazon Location Service: find each address on
// the map (Geocode), then ask for the driving route between them
// (CalculateRoutes, by car).
export class AwsDistanceProvider extends DistanceProvider {
  readonly isEstimate = false;
  private readonly logger = new Logger(AwsDistanceProvider.name);

  constructor(private readonly aws: AwsLocation) {
    super();
  }

  async drivingDistance(from: Address, to: Address): Promise<number> {
    try {
      const [start, end] = await Promise.all([
        this.locate(from, 'from'),
        this.locate(to, 'to'),
      ]);
      const response = await this.aws.routes.send(
        new CalculateRoutesCommand({
          Origin: start,
          Destination: end,
          TravelMode: 'Car',
        }),
      );
      const meters = response.Routes?.[0]?.Summary?.Distance;
      // No driving route (e.g. an island address): treat the drop-off as
      // the problem.
      if (meters === undefined) throw new UnknownAddressError('to');
      return meters;
    } catch (error) {
      if (error instanceof UnknownAddressError) throw error;
      // AWS down, throttled or misconfigured. Log the error type only, never
      // the addresses.
      this.logger.error(
        `Distance lookup failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      throw new DistanceUnavailableError();
    }
  }

  private async locate(address: Address, which: 'from' | 'to') {
    const response = await this.aws.places.send(
      new GeocodeCommand({
        QueryText: formatAddress(address),
        Filter: { IncludeCountries: ['USA'] },
        BiasPosition: TAMPA_POSITION,
        MaxResults: 1,
      }),
    );
    const match = response.ResultItems?.[0];
    if (
      !match?.Position ||
      !STREET_LEVEL_PLACE_TYPES.has(String(match.PlaceType))
    ) {
      throw new UnknownAddressError(which);
    }
    return match.Position;
  }
}
