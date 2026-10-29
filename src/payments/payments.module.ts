import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { Env } from '../config/env.validation.js';
import { BookingPaymentsService } from './booking-payments.service.js';
import { PaymentGateway } from './payment-gateway.js';
import { FakePaymentGateway } from './providers/fake-payment.gateway.js';
import { StripePaymentGateway } from './providers/stripe-payment.gateway.js';

@Module({
  providers: [
    {
      provide: PaymentGateway,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PaymentGateway => {
        if (config.get('PAYMENT_PROVIDER', { infer: true }) === 'fake') {
          return new FakePaymentGateway();
        }
        // Config validation guarantees a key is present for "stripe". The
        // Stripe library pins its own API version.
        return new StripePaymentGateway(
          new Stripe(config.get('STRIPE_SECRET_KEY', { infer: true })!),
          {
            publishableKey: config.get('STRIPE_PUBLISHABLE_KEY', {
              infer: true,
            })!,
            webhookSecret:
              config.get('STRIPE_WEBHOOK_SECRET', { infer: true }) || undefined,
          },
        );
      },
    },
    BookingPaymentsService,
  ],
  exports: [PaymentGateway, BookingPaymentsService],
})
export class PaymentsModule {}
