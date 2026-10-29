import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';
import { StaffAuthController } from './staff-auth.controller.js';
import { StaffAuthGuard } from './staff-auth.guard.js';
import { StaffAuthService } from './staff-auth.service.js';
import { StaffInviteService } from './staff-invite.service.js';
import { StaffSessionService } from './staff-session.service.js';

@Module({
  controllers: [StaffAuthController],
  providers: [
    StaffAuthService,
    StaffInviteService,
    StaffSessionService,
    StaffAuthGuard,
    AdminGuard,
  ],
  exports: [
    StaffInviteService,
    StaffSessionService,
    StaffAuthGuard,
    AdminGuard,
  ],
})
export class StaffAuthModule {}
