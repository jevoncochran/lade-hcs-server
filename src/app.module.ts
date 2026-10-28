import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AddressesModule } from './addresses/addresses.module.js';
import { AuditModule } from './audit/audit.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { OriginGuard } from './common/guards/origin.guard.js';
import { rateLimitOptions } from './config/rate-limit.config.js';
import { validateEnv } from './config/env.validation.js';
import { CryptoModule } from './crypto/crypto.module.js';
import { CustomerAuthModule } from './customer-auth/customer-auth.module.js';
import { HealthModule } from './health/health.module.js';
import { MailModule } from './mail/mail.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { QuotesModule } from './quotes/quotes.module.js';
import { StripeWebhookModule } from './payments/stripe-webhook.module.js';
import { StaffAuthModule } from './staff-auth/staff-auth.module.js';
import { StaffBookingsModule } from './staff-bookings/staff-bookings.module.js';
import { StaffMembersModule } from './staff-members/staff-members.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // Tests get their settings only from the test runner (.env.test),
      // never from a developer's .env (which may hold real Stripe keys).
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: rateLimitOptions,
    }),
    CryptoModule,
    PrismaModule,
    AuditModule,
    MailModule,
    HealthModule,
    CustomerAuthModule,
    StaffAuthModule,
    StaffBookingsModule,
    StaffMembersModule,
    QuotesModule,
    BookingsModule,
    StripeWebhookModule,
    AddressesModule,
  ],
  providers: [
    // Order matters: rate limit first, then the CSRF origin check.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
  ],
})
export class AppModule {}
