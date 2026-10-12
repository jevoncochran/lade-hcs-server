import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { CustomerAuthGuard } from '../customer-auth/customer-auth.guard.js';
import { AddressNotFoundFilter } from '../mileage/address-not-found.filter.js';
import { CreateQuoteDto } from './dto/create-quote.dto.js';
import { QuotesService } from './quotes.service.js';

// Signed-in customers only: booking needs an account, and each quote may
// call a paid mapping service.
@Controller('quotes')
@UseGuards(CustomerAuthGuard)
@UseFilters(AddressNotFoundFilter)
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  create(@Body() dto: CreateQuoteDto) {
    return this.quotes.quote(dto);
  }
}
