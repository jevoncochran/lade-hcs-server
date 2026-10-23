import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { StaffAuthModule } from '../staff-auth/staff-auth.module.js';
import { StaffBookingActionsService } from './staff-booking-actions.service.js';
import { StaffBookingsController } from './staff-bookings.controller.js';
import { StaffBookingsService } from './staff-bookings.service.js';

@Module({
  imports: [StaffAuthModule, PaymentsModule],
  controllers: [StaffBookingsController],
  providers: [StaffBookingsService, StaffBookingActionsService],
})
export class StaffBookingsModule {}
