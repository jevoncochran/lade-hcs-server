import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CustomerAuthGuard } from '../customer-auth/customer-auth.guard.js';
import { AddressSearch } from './address-search.js';
import { SuggestAddressesDto } from './dto/suggest-addresses.dto.js';

// Address autofill for the booking form. Signed-in customers only: every
// lookup is a paid AWS request. Queries and results are never logged (PHI).
@Controller('addresses')
@UseGuards(CustomerAuthGuard)
export class AddressesController {
  constructor(private readonly search: AddressSearch) {}

  @Get('suggest')
  async suggest(@Query() dto: SuggestAddressesDto) {
    return {
      // False when autofill isn't configured: the form just hides it.
      available: this.search.available,
      suggestions: await this.search.suggest(dto.q),
    };
  }

  @Get('places/:placeId')
  async lookup(@Param('placeId') placeId: string) {
    // AWS place ids are long opaque strings; reject anything odd before
    // spending a request on it.
    if (!/^[\w=+/-]{10,1000}$/.test(placeId)) {
      throw new NotFoundException('Address not found.');
    }
    const address = await this.search.lookup(placeId);
    if (!address) throw new NotFoundException('Address not found.');
    return address;
  }
}
