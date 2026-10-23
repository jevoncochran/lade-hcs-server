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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ReqMeta,
  type RequestMeta,
} from '../common/decorators/req-meta.decorator.js';
import { CurrentStaff } from '../staff-auth/current-staff.decorator.js';
import { StaffAuthGuard } from '../staff-auth/staff-auth.guard.js';
import type { SessionStaff } from '../staff-auth/staff-session.service.js';
import { CancelBookingDto } from './dto/cancel-booking.dto.js';
import { CompleteBookingDto } from './dto/complete-booking.dto.js';
import { ListStaffBookingsDto } from './dto/list-staff-bookings.dto.js';
import { StaffBookingActionsService } from './staff-booking-actions.service.js';
import { StaffBookingsService } from './staff-bookings.service.js';

const BookingId = () => Param('id', new ParseUUIDPipe({ version: '4' }));

// Bookings for the staff dashboard (/admin). Dispatchers and admins alike.
// Patient information: never cached by the browser or anything in between.
@Controller('staff/bookings')
@UseGuards(StaffAuthGuard)
export class StaffBookingsController {
  constructor(
    private readonly bookings: StaffBookingsService,
    private readonly actions: StaffBookingActionsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentStaff() staff: SessionStaff,
    @Query() query: ListStaffBookingsDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.bookings.list(staff, query, meta);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(
    @CurrentStaff() staff: SessionStaff,
    @BookingId() id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.bookings.get(staff, id, meta);
  }

  // Actions (dispatchers and admins; waiving a fee is admin-only). Each
  // returns the updated booking.

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  confirm(
    @CurrentStaff() staff: SessionStaff,
    @BookingId() id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.actions.confirm(staff, id, meta);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  cancel(
    @CurrentStaff() staff: SessionStaff,
    @BookingId() id: string,
    @Body() dto: CancelBookingDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.actions.cancel(staff, id, dto, meta);
  }

  @Post(':id/no-show')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  noShow(
    @CurrentStaff() staff: SessionStaff,
    @BookingId() id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.actions.noShow(staff, id, meta);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  complete(
    @CurrentStaff() staff: SessionStaff,
    @BookingId() id: string,
    @Body() dto: CompleteBookingDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.actions.complete(staff, id, dto, meta);
  }

  @Post(':id/retry-charge')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  retryCharge(
    @CurrentStaff() staff: SessionStaff,
    @BookingId() id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.actions.retryCharge(staff, id, meta);
  }
}
