import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { CustomerAuthGuard } from '../customer-auth/customer-auth.guard.js';
import { AddressNotFoundError } from '../mileage/distance-provider.js';
import { CreateQuoteDto } from './dto/create-quote.dto.js';
import { QuotesService } from './quotes.service.js';

// Signed-in customers only: booking needs an account, and each quote may
// call a paid mapping service.
@Controller('quotes')
@UseGuards(CustomerAuthGuard)
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async create(@Body() dto: CreateQuoteDto) {
    try {
      return await this.quotes.quote(dto);
    } catch (error) {
      // An address the map can't find: say which one, so the form can point
      // at it. The address itself is never logged (PHI).
      if (error instanceof AddressNotFoundError) {
        throw new UnprocessableEntityException({
          message: error.message,
          field: error.which,
        });
      }
      throw error;
    }
  }
}
