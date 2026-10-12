import {
  AutocompleteCommand,
  GetPlaceCommand,
  type Address as AwsAddress,
} from '@aws-sdk/client-geo-places';
import {
  TAMPA_POSITION,
  type AwsLocation,
} from '../../location/aws-location.js';
import type { Address } from '../../mileage/address.js';
import { AddressSearch, type AddressSuggestion } from '../address-search.js';

const MAX_SUGGESTIONS = 5;

// Address autofill from Amazon Location Service Places. Suggestions are
// display-only (AWS "single use"); the chosen place is fetched with
// IntendedUse "Storage" because it's saved with the booking, as AWS's terms
// require for stored results.
export class AwsAddressSearch extends AddressSearch {
  readonly available = true;

  constructor(private readonly aws: AwsLocation) {
    super();
  }

  async suggest(query: string): Promise<AddressSuggestion[]> {
    const response = await this.aws.places.send(
      new AutocompleteCommand({
        QueryText: query,
        BiasPosition: TAMPA_POSITION,
        Filter: { IncludeCountries: ['USA'] },
        MaxResults: MAX_SUGGESTIONS,
      }),
    );
    return (response.ResultItems ?? []).flatMap((item) =>
      item.PlaceId
        ? [
            {
              placeId: item.PlaceId,
              label: item.Address?.Label ?? item.Title ?? '',
            },
          ]
        : [],
    );
  }

  async lookup(placeId: string): Promise<Address | null> {
    const place = await this.aws.places.send(
      new GetPlaceCommand({ PlaceId: placeId, IntendedUse: 'Storage' }),
    );
    return place.Address ? toAddress(place.Address) : null;
  }
}

// AWS's address parts → our form fields. Only complete US street addresses
// count: anything missing a street, city, state or ZIP returns null and the
// customer types the rest themselves.
export const toAddress = (address: AwsAddress): Address | null => {
  const line1 = [address.AddressNumber, address.Street]
    .filter(Boolean)
    .join(' ')
    .trim();
  const zip = address.PostalCode?.slice(0, 5);
  const state = address.Region?.Code;

  if (
    address.Country?.Code3 !== 'USA' ||
    !line1 ||
    !address.Locality ||
    !state ||
    !zip ||
    !/^\d{5}$/.test(zip)
  ) {
    return null;
  }
  return { line1, city: address.Locality, state: state.toUpperCase(), zip };
};
