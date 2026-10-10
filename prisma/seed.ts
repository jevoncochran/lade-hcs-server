import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  CareLevel,
  PriceChannel,
  PrismaClient,
} from '../src/generated/prisma/client.js';

// Starting rates from Lade's 2026 rate card (public = partner rates for now).
// Stretcher rate and all no-show / late-cancel fees are proposed, pending
// Lade's sign-off. See docs/plan.md → Pricing.
//
// Safe to re-run: a care level that already has an active rule is skipped, so
// prices changed later by an admin are never overwritten.
const startingRates = [
  {
    careLevel: CareLevel.AMBULATORY,
    oneWayBaseCents: 5000,
    roundTripBaseCents: 10000,
    perMileCents: 350,
    noShowFeeCents: 5000,
    lateCancelFeeCents: 2500,
  },
  {
    careLevel: CareLevel.WHEELCHAIR,
    oneWayBaseCents: 7500,
    roundTripBaseCents: 15000,
    perMileCents: 400,
    noShowFeeCents: 7500,
    lateCancelFeeCents: 3750,
  },
  {
    careLevel: CareLevel.BARIATRIC_WHEELCHAIR,
    oneWayBaseCents: 12500,
    roundTripBaseCents: 25000,
    perMileCents: 400,
    noShowFeeCents: 12500,
    lateCancelFeeCents: 6250,
  },
  {
    careLevel: CareLevel.STRETCHER,
    oneWayBaseCents: 17500,
    roundTripBaseCents: 35000,
    perMileCents: 500,
    noShowFeeCents: 17500,
    lateCancelFeeCents: 8750,
  },
];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const main = async () => {
  for (const rate of startingRates) {
    const active = await prisma.pricingRule.findFirst({
      where: {
        channel: PriceChannel.PUBLIC,
        careLevel: rate.careLevel,
        effectiveTo: null,
      },
    });

    if (active) {
      console.log(`skip   ${rate.careLevel} (active rule exists)`);
      continue;
    }

    await prisma.pricingRule.create({
      data: { channel: PriceChannel.PUBLIC, ...rate },
    });
    console.log(`create ${rate.careLevel}`);
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
