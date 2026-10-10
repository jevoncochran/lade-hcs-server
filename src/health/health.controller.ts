import {
  Controller,
  Get,
  Header,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

// How long to wait for the database before reporting it down. Kept short so
// Cloud Run's probe gets an answer well inside its own timeout.
export const DB_PING_TIMEOUT_MS = 2000;

// Connection errors from the pg driver often have an empty message (e.g. an
// AggregateError of ECONNREFUSED for IPv4 and IPv6), so include the error
// name, code and any inner errors.
const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: unknown }).code;
  const parts = [error.name, code, error.message].filter(Boolean);
  const inner =
    error instanceof AggregateError
      ? error.errors.map((e) => describeError(e)).join('; ')
      : '';
  return [parts.join(' '), inner && `[${inner}]`].filter(Boolean).join(' ');
};

export type HealthStatus = { status: 'ok'; database: 'up' };

// Public endpoint for Cloud Run startup/liveness probes and uptime monitors.
// Returns only ok/down: no versions, counts, error details or PHI.
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async check(): Promise<HealthStatus> {
    try {
      await this.pingDatabase();
      return { status: 'ok', database: 'up' };
    } catch (error) {
      // Details go to the server log only, never the response.
      this.logger.error(
        `Database health check failed: ${describeError(error)}`,
      );
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
      });
    }
  }

  private async pingDatabase() {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no response in ${DB_PING_TIMEOUT_MS}ms`)),
        DB_PING_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
