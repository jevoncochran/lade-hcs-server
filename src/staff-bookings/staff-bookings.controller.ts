import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
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
import { ListStaffBookingsDto } from './dto/list-staff-bookings.dto.js';
import { StaffBookingsService } from './staff-bookings.service.js';

// Bookings for the staff dashboard (/admin). Dispatchers and admins alike.
// Patient information: never cached by the browser or anything in between.
@Controller('staff/bookings')
@UseGuards(StaffAuthGuard)
export class StaffBookingsController {
  constructor(private readonly bookings: StaffBookingsService) {}

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
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.bookings.get(staff, id, meta);
  }
}
