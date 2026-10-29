import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  CareLevel,
  PriceChannel,
  TripKind,
} from '../src/generated/prisma/client.js';
import { METERS_PER_MILE } from '../src/pricing/pricing.js';
import { PricingService } from '../src/pricing/pricing.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, resetBookingTables } from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Choosing the rate that's in effect, against the real database.
describe('PricingService (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let pricing: PricingService;

  const rates = (oneWayBaseCents: number) => ({
    oneWayBaseCents,
    roundTripBaseCents: oneWayBaseCents * 2,
    perMileCents: 400,
    noShowFeeCents: oneWayBaseCents,
    lateCancelFeeCents: oneWayBaseCents / 2,
  });

  const oneWay = (miles: number) => ({
    tripKind: TripKind.ONE_WAY,
    legs: [
      {
        distanceMeters: miles * METERS_PER_MILE,
        pickupState: 'FL',
        dropoffState: 'FL',
      },
    ],
  });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp(AppModule));
    pricing = app.get(PricingService);
    await resetBookingTables(prisma);
    await prisma.pricingRule.deleteMany();
  });

  afterEach(async () => {
    await prisma.pricingRule.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('uses the newest rule that has started and not ended', async () => {
    const now = Date.now();
    await prisma.pricingRule.createMany({
      data: [
        // Old price, ended yesterday.
        {
          careLevel: CareLevel.WHEELCHAIR,
          ...rates(7000),
          effectiveFrom: new Date(now - 30 * DAY_MS),
          effectiveTo: new Date(now - DAY_MS),
        },
        // Current price.
        {
          careLevel: CareLevel.WHEELCHAIR,
          ...rates(7500),
          effectiveFrom: new Date(now - DAY_MS),
        },
        // Price increase scheduled for next week.
        {
          careLevel: CareLevel.WHEELCHAIR,
          ...rates(8000),
          effectiveFrom: new Date(now + 7 * DAY_MS),
        },
      ],
    });

    expect(
      (await pricing.findActiveRule(CareLevel.WHEELCHAIR))?.oneWayBaseCents,
    ).toBe(7500);
    expect(
      (
        await pricing.findActiveRule(
          CareLevel.WHEELCHAIR,
          new Date(now - 10 * DAY_MS),
        )
      )?.oneWayBaseCents,
    ).toBe(7000);
    expect(
      (
        await pricing.findActiveRule(
          CareLevel.WHEELCHAIR,
          new Date(now + 8 * DAY_MS),
        )
      )?.oneWayBaseCents,
    ).toBe(8000);
  });

  it('ignores partner rates for public quotes', async () => {
    await prisma.pricingRule.create({
      data: {
        careLevel: CareLevel.AMBULATORY,
        channel: PriceChannel.PARTNER,
        ...rates(4000),
      },
    });

    expect(await pricing.findActiveRule(CareLevel.AMBULATORY)).toBeNull();
  });

  it('quotes with the active rule and returns which rule it used', async () => {
    const rule = await prisma.pricingRule.create({
      data: { careLevel: CareLevel.BARIATRIC_WHEELCHAIR, ...rates(12500) },
    });

    const { quote, rule: used } = await pricing.quote(
      CareLevel.BARIATRIC_WHEELCHAIR,
      oneWay(10),
    );

    expect(used?.id).toBe(rule.id);
    expect(quote).toMatchObject({ kind: 'priced', totalCents: 12500 + 4000 });
  });

  it('asks for a custom quote when a care level has no rule (e.g. stretcher)', async () => {
    const { quote, rule } = await pricing.quote(
      CareLevel.STRETCHER,
      oneWay(10),
    );

    expect(rule).toBeNull();
    expect(quote).toEqual({ kind: 'call_for_quote', reason: 'NO_RATE' });
  });

  it('uses LONG_DISTANCE_MAX_MILES from config', async () => {
    await prisma.pricingRule.create({
      data: { careLevel: CareLevel.AMBULATORY, ...rates(5000) },
    });

    expect(
      (await pricing.quote(CareLevel.AMBULATORY, oneWay(50))).quote.kind,
    ).toBe('priced');
    expect(
      (await pricing.quote(CareLevel.AMBULATORY, oneWay(51))).quote,
    ).toEqual({
      kind: 'call_for_quote',
      reason: 'LONG_DISTANCE',
    });
  });
});
