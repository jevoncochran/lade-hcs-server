import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ReqMeta,
  type RequestMeta,
} from '../common/decorators/req-meta.decorator.js';
import { AdminGuard } from '../staff-auth/admin.guard.js';
import { CurrentStaff } from '../staff-auth/current-staff.decorator.js';
import { StaffAuthGuard } from '../staff-auth/staff-auth.guard.js';
import type { SessionStaff } from '../staff-auth/staff-session.service.js';
import { ChangeRoleDto } from './dto/change-role.dto.js';
import { InviteStaffDto } from './dto/invite-staff.dto.js';
import { StaffMembersService } from './staff-members.service.js';

const Id = () => Param('id', new ParseUUIDPipe({ version: '4' }));

// Staff management for administrators (/admin/staff). Every action returns
// the updated list; invites and resets also return their one-time link.
@Controller('staff')
@UseGuards(StaffAuthGuard, AdminGuard)
export class StaffMembersController {
  constructor(private readonly members: StaffMembersService) {}

  @Get('members')
  @Header('Cache-Control', 'no-store')
  list() {
    return this.members.overview();
  }

  @Post('invites')
  @Header('Cache-Control', 'no-store')
  invite(
    @CurrentStaff() admin: SessionStaff,
    @Body() dto: InviteStaffDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.members.invite(admin, dto.email, dto.role, meta);
  }

  @Post('invites/:id/revoke')
  @HttpCode(HttpStatus.OK)
  revokeInvite(
    @CurrentStaff() admin: SessionStaff,
    @Id() id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.members.revokeInvite(admin, id, meta);
  }

  @Post('members/:id/role')
  @HttpCode(HttpStatus.OK)
  changeRole(
    @CurrentStaff() admin: SessionStaff,
    @Id() id: string,
    @Body() dto: ChangeRoleDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.members.changeRole(admin, id, dto.role, meta);
  }

  @Post('members/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(
    @CurrentStaff() admin: SessionStaff,
    @Id() id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.members.setActive(admin, id, false, meta);
  }

  @Post('members/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(
    @CurrentStaff() admin: SessionStaff,
    @Id() id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.members.setActive(admin, id, true, meta);
  }

  @Post('members/:id/reset-sign-in')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  resetSignIn(
    @CurrentStaff() admin: SessionStaff,
    @Id() id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.members.resetSignIn(admin, id, meta);
  }
}
