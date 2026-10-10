import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { DB_PING_TIMEOUT_MS, HealthController } from './health.controller.js';

describe('HealthController', () => {
  const prisma = { $queryRaw: vi.fn() };
  let controller: HealthController;

  beforeEach(async () => {
    prisma.$queryRaw.mockReset();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();

    controller = module.get(HealthController);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports ok when the database answers', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('returns 503 with no error details when the query fails', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('password authentication failed for user "lade"'),
    );

    const error = await controller.check().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const response = (error as ServiceUnavailableException).getResponse();
    expect(response).toEqual({ status: 'error', database: 'down' });
    expect(JSON.stringify(response)).not.toContain('password');
  });

  it('returns 503 when the database does not answer in time', async () => {
    vi.useFakeTimers();
    prisma.$queryRaw.mockReturnValue(new Promise(() => {})); // never settles

    const result = controller.check().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(DB_PING_TIMEOUT_MS);

    expect(await result).toBeInstanceOf(ServiceUnavailableException);
  });

  it('logs the real cause server-side', async () => {
    const logError = vi.spyOn(Logger.prototype, 'error');
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    await controller.check().catch(() => {});

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('connection refused'),
    );
  });
});
