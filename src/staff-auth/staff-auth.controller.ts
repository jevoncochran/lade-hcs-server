import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthRateLimit } from '../auth/rate-limit.js';
import { ReqMeta, type RequestMeta } from '../auth/request-meta.js';
import {
  sessionCookieOptions,
  STAFF_SESSION_COOKIE,
} from '../auth/session-cookie.js';
import type { Env } from '../config/env.validation.js';
import { CompleteInviteDto, InviteTokenDto, StaffLoginDto } from './dto.js';
import { CurrentStaff, StaffAuthGuard } from './staff-auth.guard.js';
import { StaffAuthService } from './staff-auth.service.js';
import { StaffInviteService } from './staff-invite.service.js';
import type { SessionStaff } from './staff-session.service.js';

@Controller('staff')
export class StaffAuthController {
  constructor(
    private readonly auth: StaffAuthService,
    private readonly invites: StaffInviteService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ---------- Accepting an invite ----------

  @Post('invites/accept/start')
  @HttpCode(HttpStatus.OK)
  @AuthRateLimit()
  startInvite(@Body() dto: InviteTokenDto) {
    return this.invites.startAcceptance(dto.token);
  }

  @Post('invites/accept/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthRateLimit()
  async completeInvite(
    @Body() dto: CompleteInviteDto,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { token } = await this.invites.completeAcceptance(
      dto.token,
      dto.name,
      dto.password,
      dto.mfaCode,
      meta,
    );
    this.setSessionCookie(response, token);
  }

  // ---------- Sessions ----------

  @Post('auth/login')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthRateLimit()
  async login(
    @Body() dto: StaffLoginDto,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { token } = await this.auth.login(
      dto.email,
      dto.password,
      dto.mfaCode,
      meta,
    );
    this.setSessionCookie(response, token);
  }

  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token: unknown = request.cookies?.[STAFF_SESSION_COOKIE];
    await this.auth.logout(typeof token === 'string' ? token : undefined, meta);
    response.clearCookie(STAFF_SESSION_COOKIE, this.cookieOptions());
  }

  @Get('auth/me')
  @UseGuards(StaffAuthGuard)
  me(@CurrentStaff() staff: SessionStaff) {
    return this.auth.me(staff);
  }

  // No maxAge: the cookie ends when the browser closes. The server also ends
  // the session after 15 minutes idle or 12 hours.
  private cookieOptions() {
    return sessionCookieOptions(this.config.get('NODE_ENV', { infer: true }));
  }

  private setSessionCookie(response: Response, token: string) {
    response.cookie(STAFF_SESSION_COOKIE, token, this.cookieOptions());
  }
}
