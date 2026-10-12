import type { AwsLocation } from '../../location/aws-location.js';
import { AwsAddressSearch, toAddress } from './aws-address-search.js';

const AWS_ADDRESS = {
  Label: '3008 N Nebraska Ave, Tampa, FL 33603, United States',
  Country: { Code3: 'USA' },
  Region: { Code: 'FL', Name: 'Florida' },
  Locality: 'Tampa',
  PostalCode: '33603-4512',
  Street: 'N Nebraska Ave',
  AddressNumber: '3008',
};

describe('toAddress', () => {
  it('maps a full US street address to the form fields', () => {
    expect(toAddress(AWS_ADDRESS)).toEqual({
      line1: '3008 N Nebraska Ave',
      city: 'Tampa',
      state: 'FL',
      zip: '33603',
    });
  });

  it.each([
    ['a street', { Street: undefined, AddressNumber: undefined }],
    ['a city', { Locality: undefined }],
    ['a state', { Region: undefined }],
    ['a ZIP', { PostalCode: undefined }],
    ['to be in the US', { Country: { Code3: 'CAN' } }],
  ])('needs %s', (_label, missing) => {
    expect(toAddress({ ...AWS_ADDRESS, ...missing })).toBeNull();
  });
});

describe('AwsAddressSearch', () => {
  const places = { send: vi.fn() };
  const search = new AwsAddressSearch({ places } as unknown as AwsLocation);

  beforeEach(() => places.send.mockReset());

  it('suggests US addresses near Tampa', async () => {
    places.send.mockResolvedValue({
      ResultItems: [
        {
          PlaceId: 'place-1',
          Title: 'Title',
          Address: { Label: AWS_ADDRESS.Label },
        },
        { PlaceId: undefined, Title: 'no id' },
      ],
    });

    await expect(search.suggest('3008 N Nebr')).resolves.toEqual([
      { placeId: 'place-1', label: AWS_ADDRESS.Label },
    ]);
    expect(places.send.mock.calls[0][0].input).toMatchObject({
      QueryText: '3008 N Nebr',
      Filter: { IncludeCountries: ['USA'] },
      MaxResults: 5,
    });
  });

  it('looks up the chosen place for storage', async () => {
    places.send.mockResolvedValue({ Address: AWS_ADDRESS });

    await expect(search.lookup('place-1')).resolves.toMatchObject({
      line1: '3008 N Nebraska Ave',
    });
    expect(places.send.mock.calls[0][0].input).toEqual({
      PlaceId: 'place-1',
      IntendedUse: 'Storage',
    });
  });
});
