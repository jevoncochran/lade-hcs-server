import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp, SITE_URL } from './helpers.js';

// Config is read when AppModule is imported, so set the secret first.
const SECRET = 'test-proxy-secret-0123456789abcdef0123';
process.env.PROXY_SECRET = SECRET;

// With PROXY_SECRET set, only requests forwarded by the website (which adds
// the secret) reach the API.
describe('Proxy secret (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module.js');
    ({ app } = await createTestApp(AppModule));
  });

  afterAll(async () => {
    delete process.env.PROXY_SECRET;
    await app.close();
  });

  const get = (path: string, secret?: string) => {
    const req = request(app.getHttpServer()).get(path).set('Origin', SITE_URL);
    return secret === undefined ? req : req.set('x-lade-proxy', secret);
  };

  it('refuses requests that skipped the website', async () => {
    await get('/auth/me').expect(403);
    await get('/auth/me', 'wrong').expect(403);
    await get('/auth/me', `${SECRET}x`).expect(403);
    await request(app.getHttpServer())
      .post('/contact')
      .set('Origin', SITE_URL)
      .send({})
      .expect(403);
  });

  it('lets forwarded requests through', async () => {
    // Reaches the API: not signed in, so 401 rather than 403.
    await get('/auth/me', SECRET).expect(401);
  });

  it("keeps the health check open for Cloud Run's probes", async () => {
    await get('/health').expect(200);
  });
});
