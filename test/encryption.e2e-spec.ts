import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { BlindIndex } from '../src/crypto/blind-index.js';
import {
  CareLevel,
  RequesterRelationship,
  TripKind,
  TripType,
  type Booking,
} from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Checks what actually lands in Postgres, through the real Nest wiring,
// against the lade_hcs_test database.
describe('PHI encryption (e2e)', () => {
  let prisma: PrismaService;
  let blindIndex: BlindIndex;
  let close: () => Promise<void>;
  let pricingRuleId: string;

  const address = { line1: '5100 N Nebraska Ave', city: 'Tampa', zip: '33603' };

  const bookingData = () => ({
    reference: `LD-${randomUUID().slice(0, 8)}`,
    idempotencyKey: randomUUID(),
    careLevel: CareLevel.WHEELCHAIR,
    tripType: TripType.MEDICAL_APPOINTMENT,
    tripKind: TripKind.ONE_WAY,
    requesterRelationship: RequesterRelationship.FAMILY_CAREGIVER,
    requesterName: 'Dana Smith',
    requesterEmail: 'Dana.Smith@Example.com',
    requesterPhone: '(813) 555-0100',
    riderFirstName: 'Mary',
    riderLastName: 'Smith',
    mobilityNotes: 'Power chair, needs help on stairs',
    pricingRuleId,
    billableMeters: 16093,
    quotedPriceCents: 11000,
    priceBreakdown: [],
    termsVersion: '2026-10-01',
    termsAcceptedAt: new Date(),
  });

  // Reads the row as stored, bypassing the extension.
  const rawBooking = async (id: string) =>
    (
      await prisma.$queryRaw<
        Booking[]
      >`SELECT * FROM "Booking" WHERE id = ${id}::uuid`
    )[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = await moduleRef.init();
    close = () => app.close();
    prisma = moduleRef.get(PrismaService);
    blindIndex = moduleRef.get(BlindIndex);

    const rule = await prisma.pricingRule.create({
      data: {
        careLevel: CareLevel.WHEELCHAIR,
        oneWayBaseCents: 7500,
        roundTripBaseCents: 15000,
        perMileCents: 400,
        noShowFeeCents: 7500,
        lateCancelFeeCents: 3750,
      },
    });
    pricingRuleId = rule.id;
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { pricingRuleId } });
    await prisma.pricingRule.delete({ where: { id: pricingRuleId } });
    await close();
  });

  it('stores encrypted fields as ciphertext and returns plaintext', async () => {
    const created = await prisma.booking.create({ data: bookingData() });
    const raw = await rawBooking(created.id);

    expect(created.riderFirstName).toBe('Mary');
    expect(created.riderLastName).toBe('Smith');
    expect(created.mobilityNotes).toBe('Power chair, needs help on stairs');

    expect(raw.riderLastName).toMatch(/^v1:k1:/);
    expect(raw.requesterEmail).toMatch(/^v1:k1:/);
    expect(JSON.stringify(raw)).not.toMatch(/Mary|Dana|Power chair|0100/);
  });

  it('derives the search hashes from the plaintext', async () => {
    const created = await prisma.booking.create({ data: bookingData() });
    const raw = await rawBooking(created.id);

    expect(raw.requesterEmailHash).toBe(
      blindIndex.hash('email', 'dana.smith@example.com'),
    );
    expect(raw.requesterPhoneHash).toBe(blindIndex.hash('phone', '8135550100'));
    expect(raw.riderLastNameHash).toBe(blindIndex.hash('name', 'smith'));
  });

  it('finds bookings by hash with a differently formatted search', async () => {
    const created = await prisma.booking.create({ data: bookingData() });

    const found = await prisma.booking.findMany({
      where: {
        requesterPhoneHash: blindIndex.hash('phone', '+1 813-555-0100'),
        pricingRuleId,
      },
    });

    expect(found.map((b) => b.id)).toContain(created.id);
    expect(found.every((b) => b.requesterPhone === '(813) 555-0100')).toBe(
      true,
    );
  });

  it('encrypts nested legs and decrypts them when included', async () => {
    const created = await prisma.booking.create({
      data: {
        ...bookingData(),
        legs: {
          create: [
            {
              direction: 'OUTBOUND',
              pickupAddress: JSON.stringify(address),
              dropoffAddress: JSON.stringify({ line1: 'Tampa General' }),
              distanceMeters: 16093,
            },
          ],
        },
      },
      include: { legs: true },
    });

    const [rawLeg] = await prisma.$queryRaw<
      { pickupAddress: string }[]
    >`SELECT "pickupAddress" FROM "TripLeg" WHERE "bookingId" = ${created.id}::uuid`;
    expect(rawLeg.pickupAddress).toMatch(/^v1:k1:/);
    expect(rawLeg.pickupAddress).not.toContain('Nebraska');

    const reread = await prisma.booking.findUniqueOrThrow({
      where: { id: created.id },
      include: { legs: true },
    });
    expect(JSON.parse(reread.legs[0].pickupAddress)).toEqual(address);
  });

  it('encrypts updates and refreshes the matching hash', async () => {
    const created = await prisma.booking.create({ data: bookingData() });

    const updated = await prisma.booking.update({
      where: { id: created.id },
      data: { riderLastName: 'Jones', instructions: 'Gate code 4512' },
    });
    const raw = await rawBooking(created.id);

    expect(updated.riderLastName).toBe('Jones');
    expect(raw.instructions).toMatch(/^v1:k1:/);
    expect(raw.riderLastNameHash).toBe(blindIndex.hash('name', 'Jones'));
  });

  it('keeps null optional fields as null', async () => {
    const created = await prisma.booking.create({ data: bookingData() });

    expect(created.riderPhone).toBeNull();
    expect((await rawBooking(created.id)).riderPhone).toBeNull();
  });

  it('encrypts createMany rows', async () => {
    const rows = [bookingData(), bookingData()];
    await prisma.booking.createMany({ data: rows });

    const raw = await prisma.$queryRaw<
      { riderLastName: string }[]
    >`SELECT "riderLastName" FROM "Booking" WHERE reference IN (${rows[0].reference}, ${rows[1].reference})`;
    expect(raw).toHaveLength(2);
    expect(raw.every((r) => r.riderLastName.startsWith('v1:'))).toBe(true);
  });

  it('refuses to filter on an encrypted field', async () => {
    await expect(
      prisma.booking.findMany({ where: { riderLastName: 'Smith' } }),
    ).rejects.toThrow(
      /Cannot filter or sort on encrypted field Booking.riderLastName; filter on riderLastNameHash/,
    );
  });

  it('refuses to filter on an encrypted field through a relation', async () => {
    await expect(
      prisma.booking.findMany({
        where: { legs: { some: { pickupAddress: 'anything' } } },
      }),
    ).rejects.toThrow(/encrypted field TripLeg.pickupAddress/);
  });

  it('refuses to sort on an encrypted field', async () => {
    await expect(
      prisma.booking.findMany({ orderBy: { riderLastName: 'asc' } }),
    ).rejects.toThrow(/encrypted field Booking.riderLastName/);
  });

  it('refuses to set a search hash directly', async () => {
    await expect(
      prisma.booking.create({
        data: { ...bookingData(), riderLastNameHash: 'forged' } as never,
      }),
    ).rejects.toThrow(/riderLastNameHash is derived from riderLastName/);
  });
});
