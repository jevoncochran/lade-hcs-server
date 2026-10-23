import { Module } from '@nestjs/common';
import { StaffAuthModule } from '../staff-auth/staff-auth.module.js';
import { StaffBookingsController } from './staff-bookings.controller.js';
import { StaffBookingsService } from './staff-bookings.service.js';

@Module({
  imports: [StaffAuthModule],
  controllers: [StaffBookingsController],
  providers: [StaffBookingsService],
})
export class StaffBookingsModule {}
