import { Module } from '@nestjs/common';
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
  ],
  exports: [StaffInviteService, StaffSessionService, StaffAuthGuard],
})
export class StaffAuthModule {}
