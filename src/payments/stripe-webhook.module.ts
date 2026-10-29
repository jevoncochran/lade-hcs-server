import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { PaymentsModule } from './payments.module.js';
import { StripeWebhookController } from './stripe-webhook.controller.js';

// Separate from PaymentsModule because it needs BookingsService, and
// BookingsModule already depends on PaymentsModule.
@Module({
  imports: [PaymentsModule, BookingsModule],
  controllers: [StripeWebhookController],
})
export class StripeWebhookModule {}
