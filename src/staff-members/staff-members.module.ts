import { Module } from '@nestjs/common';
import { StaffAuthModule } from '../staff-auth/staff-auth.module.js';
import { StaffMembersController } from './staff-members.controller.js';
import { StaffMembersService } from './staff-members.service.js';

@Module({
  imports: [StaffAuthModule],
  controllers: [StaffMembersController],
  providers: [StaffMembersService],
})
export class StaffMembersModule {}
