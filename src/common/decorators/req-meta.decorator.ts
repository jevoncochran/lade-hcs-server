import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

// Client details recorded in the audit log.
export type RequestMeta = { ipAddress?: string; userAgent?: string };

export const requestMetaOf = (request: Request): RequestMeta => ({
  ipAddress: request.ip,
  userAgent: request.headers['user-agent']?.slice(0, 256),
});

export const ReqMeta = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    requestMetaOf(context.switchToHttp().getRequest<Request>()),
);
