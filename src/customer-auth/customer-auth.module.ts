import { Module } from '@nestjs/common';
import { CustomerAuthController } from './customer-auth.controller.js';
import { CustomerAuthGuard } from './customer-auth.guard.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { CustomerSessionService } from './customer-session.service.js';

@Module({
  controllers: [CustomerAuthController],
  providers: [CustomerAuthService, CustomerSessionService, CustomerAuthGuard],
  exports: [CustomerSessionService, CustomerAuthGuard],
})
export class CustomerAuthModule {}
