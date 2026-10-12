import { withAPIKey } from '@aws/amazon-location-utilities-auth-helper';
import { GeoPlacesClient } from '@aws-sdk/client-geo-places';
import { GeoRoutesClient } from '@aws-sdk/client-geo-routes';

// Connections to Amazon Location Service (Places + Routes), shared by the
// distance provider and address autofill. Covered by the AWS BAA once it's
// accepted; until then, never send real rider addresses.
export class AwsLocation {
  constructor(
    readonly places: GeoPlacesClient,
    readonly routes: GeoRoutesClient,
  ) {}

  static withApiKey(apiKey: string, region: string) {
    const auth = withAPIKey(apiKey, region);
    return new AwsLocation(
      new GeoPlacesClient(auth.getClientConfig()),
      new GeoRoutesClient(auth.getClientConfig()),
    );
  }
}

// Results lean toward the Tampa area: [longitude, latitude].
export const TAMPA_POSITION = [-82.4572, 27.9506];

// AWS returns these for street-level matches. Anything vaguer (a city, ZIP
// code or county) means the street address itself wasn't found.
export const STREET_LEVEL_PLACE_TYPES = new Set([
  'PointAddress',
  'InterpolatedAddress',
  'Street',
  'PointOfInterest',
]);
