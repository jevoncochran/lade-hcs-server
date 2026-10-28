import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { BackgroundCheck } from '../common/decorators/background-check.decorator.js';
import {
  ReqMeta,
  type RequestMeta,
} from '../common/decorators/req-meta.decorator.js';
import { CurrentCustomer } from '../customer-auth/current-customer.decorator.js';
import { CustomerAuthGuard } from '../customer-auth/customer-auth.guard.js';
import type { SessionCustomer } from '../customer-auth/customer-session.service.js';
import { AddressNotFoundFilter } from '../mileage/address-not-found.filter.js';
import { BookingsService } from './bookings.service.js';
import { CancelRideDto } from './dto/cancel-ride.dto.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';

// A customer's own bookings. Staff endpoints live separately (admin).
@Controller('bookings')
@UseGuards(CustomerAuthGuard)
@UseFilters(AddressNotFoundFilter)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  create(
    @CurrentCustomer() customer: SessionCustomer,
    @Body() dto: CreateBookingDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.bookings.create(customer, dto, meta);
  }

  // After the customer finishes the card form: checks with the payment
  // provider and, if the card was saved, moves the booking to REQUESTED.
  @Post(':id/confirm-card')
  @HttpCode(HttpStatus.OK)
  confirmCard(
    @CurrentCustomer() customer: SessionCustomer,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.bookings.confirmCard(customer, id, meta);
  }

  @Get()
  list(@CurrentCustomer() customer: SessionCustomer) {
    return this.bookings.list(customer);
  }

  // Open pages ask this every few seconds and reload when it changes.
  @Get('changes')
  @BackgroundCheck()
  @Header('Cache-Control', 'no-store')
  changes(@CurrentCustomer() customer: SessionCustomer) {
    return this.bookings.version(customer);
  }

  @Get(':id')
  get(
    @CurrentCustomer() customer: SessionCustomer,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.bookings.get(customer, id);
  }

  // The customer cancelling their own ride (fee rules in the service).
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentCustomer() customer: SessionCustomer,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CancelRideDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.bookings.cancel(customer, id, dto, meta);
  }
}
