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
import { AuthRateLimit } from '../common/decorators/auth-rate-limit.decorator.js';
import {
  ReqMeta,
  type RequestMeta,
} from '../common/decorators/req-meta.decorator.js';
import {
  CUSTOMER_SESSION_COOKIE,
  sessionCookieOptions,
} from '../auth/session-cookie.js';
import type { Env } from '../config/env.validation.js';
import { CurrentCustomer } from './current-customer.decorator.js';
import { CustomerAuthGuard } from './customer-auth.guard.js';
import { CustomerAuthService } from './customer-auth.service.js';
import {
  CUSTOMER_ABSOLUTE_MS,
  type SessionCustomer,
} from './customer-session.service.js';
import { EmailDto } from './dto/email.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SignupDto } from './dto/signup.dto.js';
import { TokenDto } from './dto/token.dto.js';

@Controller('auth')
export class CustomerAuthController {
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('signup')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthRateLimit()
  signup(@Body() dto: SignupDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.signup(dto, meta);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @AuthRateLimit()
  verifyEmail(@Body() dto: TokenDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.verifyEmail(dto.token, meta);
  }

  @Post('verify-email/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthRateLimit()
  resendVerification(@Body() dto: EmailDto) {
    return this.auth.resendVerification(dto.email);
  }

  @Post('login')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuthRateLimit()
  async login(
    @Body() dto: LoginDto,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { token } = await this.auth.login(dto.email, dto.password, meta);
    response.cookie(
      CUSTOMER_SESSION_COOKIE,
      token,
      sessionCookieOptions(
        this.config.get('NODE_ENV', { infer: true }),
        CUSTOMER_ABSOLUTE_MS,
      ),
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token: unknown = request.cookies?.[CUSTOMER_SESSION_COOKIE];
    await this.auth.logout(typeof token === 'string' ? token : undefined, meta);
    response.clearCookie(
      CUSTOMER_SESSION_COOKIE,
      sessionCookieOptions(this.config.get('NODE_ENV', { infer: true })),
    );
  }

  @Get('me')
  @UseGuards(CustomerAuthGuard)
  me(@CurrentCustomer() customer: SessionCustomer) {
    return this.auth.me(customer);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthRateLimit()
  forgotPassword(@Body() dto: EmailDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.forgotPassword(dto.email, meta);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @AuthRateLimit()
  resetPassword(@Body() dto: ResetPasswordDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.resetPassword(dto.token, dto.password, meta);
  }
}
