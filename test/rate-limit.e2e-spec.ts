import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { browser, createTestApp, uniqueEmail } from './helpers.js';

// Config is read when AppModule is imported, so lower the limit first and
// import the module afterwards.
process.env.AUTH_RATE_LIMIT_PER_MINUTE = '3';

describe('Auth rate limiting (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module.js');
    ({ app } = await createTestApp(AppModule));
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 once an IP exceeds the per-minute limit on a login endpoint', async () => {
    const client = browser(app);
    const body = {
      email: uniqueEmail('limited'),
      password: 'whatever password',
    };

    for (let i = 0; i < 3; i++) {
      await client.post('/auth/login', body).expect(401);
    }
    await client.post('/auth/login', body).expect(429);
  });

  it('does not apply the auth limit to other endpoints', async () => {
    const client = browser(app);

    for (let i = 0; i < 5; i++) {
      await client.get('/health').expect(200);
    }
  });
});
