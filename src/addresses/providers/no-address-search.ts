import { AddressSearch } from '../address-search.js';

// Used without AWS Location: the form works, just without suggestions.
export class NoAddressSearch extends AddressSearch {
  readonly available = false;

  async suggest() {
    return [];
  }

  async lookup() {
    return null;
  }
}
