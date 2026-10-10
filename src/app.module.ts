import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module.js';
import { OriginGuard } from './auth/origin.guard.js';
import { rateLimitOptions } from './auth/rate-limit.js';
import { validateEnv } from './config/env.validation.js';
import { CryptoModule } from './crypto/crypto.module.js';
import { CustomerAuthModule } from './customer-auth/customer-auth.module.js';
import { HealthModule } from './health/health.module.js';
import { MailModule } from './mail/mail.module.js';
import { PricingModule } from './pricing/pricing.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { StaffAuthModule } from './staff-auth/staff-auth.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
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
    PricingModule,
    CustomerAuthModule,
    StaffAuthModule,
  ],
  providers: [
    // Order matters: rate limit first, then the CSRF origin check.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
  ],
})
export class AppModule {}
