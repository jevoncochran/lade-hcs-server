import { Module } from '@nestjs/common';
import { BookingNotificationsService } from './booking-notifications.service.js';

// Emails about bookings (the Mailer itself is global, in MailModule).
@Module({
  providers: [BookingNotificationsService],
  exports: [BookingNotificationsService],
})
export class NotificationsModule {}
