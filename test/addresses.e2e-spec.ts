import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { AddressSearch } from '../src/addresses/address-search.js';
import type { LogMailer } from '../src/mail/mailer.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  browser,
  createTestApp,
  resetAccountTables,
  signedInCustomer,
} from './helpers.js';

const fakeSearch = {
  available: true,
  suggest: vi.fn(async () => [
    { placeId: 'place-abc-123', label: '3008 N Nebraska Ave, Tampa, FL 33603' },
  ]),
  lookup: vi.fn(async (placeId: string) =>
    placeId === 'place-abc-123'
      ? {
          line1: '3008 N Nebraska Ave',
          city: 'Tampa',
          state: 'FL',
          zip: '33603',
        }
      : null,
  ),
};

describe('Address autofill (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: LogMailer;
  let client: Awaited<ReturnType<typeof signedInCustomer>>;

  beforeAll(async () => {
    ({ app, prisma, mailer } = await createTestApp(AppModule, (builder) =>
      builder.overrideProvider(AddressSearch).useValue(fakeSearch),
    ));
    await resetAccountTables(prisma);
    client = await signedInCustomer(app, mailer);
  });

  afterAll(async () => {
    await app.close();
  });

  it('suggests addresses as the customer types', async () => {
    const response = await client
      .get('/addresses/suggest?q=3008%20N%20Nebr')
      .expect(200);

    expect(response.body).toEqual({
      available: true,
      suggestions: [
        {
          placeId: 'place-abc-123',
          label: '3008 N Nebraska Ave, Tampa, FL 33603',
        },
      ],
    });
    expect(fakeSearch.suggest).toHaveBeenCalledWith('3008 N Nebr');
  });

  it('needs at least 3 characters', async () => {
    await client.get('/addresses/suggest?q=30').expect(400);
  });

  it('returns the chosen place as form fields', async () => {
    const response = await client
      .get('/addresses/places/place-abc-123')
      .expect(200);

    expect(response.body).toEqual({
      line1: '3008 N Nebraska Ave',
      city: 'Tampa',
      state: 'FL',
      zip: '33603',
    });
  });

  it('404s for unknown or malformed place ids', async () => {
    await client.get('/addresses/places/place-unknown-999').expect(404);
    await client.get('/addresses/places/bad').expect(404);
  });

  it('requires a signed-in customer', async () => {
    await browser(app).get('/addresses/suggest?q=3008').expect(401);
  });
});

describe('Address autofill without AWS (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mailer: LogMailer;

  beforeAll(async () => {
    ({ app, prisma, mailer } = await createTestApp(AppModule));
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports autofill as unavailable with no suggestions', async () => {
    const client = await signedInCustomer(app, mailer);
    const response = await client.get('/addresses/suggest?q=3008').expect(200);

    expect(response.body).toEqual({ available: false, suggestions: [] });
    void prisma;
  });
});
