import { ChargeType, TripKind } from '../generated/prisma/client.js';
import {
  billableTenths,
  lateCancellationCharge,
  METERS_PER_MILE,
  noShowCharge,
  quoteTrip,
  totalOf,
  waitTimeCharge,
  type QuoteLeg,
  type Rates,
} from './pricing.js';

// Lade's rate card (and the proposed stretcher / fee values).
const rate = (
  oneWay: number,
  roundTrip: number,
  perMile: number,
  noShow: number,
  lateCancel: number,
): Rates => ({
  oneWayBaseCents: oneWay,
  roundTripBaseCents: roundTrip,
  perMileCents: perMile,
  waitGraceMinutes: 15,
  waitIncrementMinutes: 15,
  waitIncrementCents: 1500,
  noShowFeeCents: noShow,
  lateCancelFeeCents: lateCancel,
});

const AMBULATORY = rate(5000, 10000, 350, 5000, 2500);
const WHEELCHAIR = rate(7500, 15000, 400, 7500, 3750);
const BARIATRIC = rate(12500, 25000, 400, 12500, 6250);
const STRETCHER = rate(17500, 35000, 500, 17500, 8750);

const LIMITS = { longDistanceMaxMiles: 50, serviceState: 'FL' };

const miles = (n: number) => n * METERS_PER_MILE;

const leg = (
  mi: number,
  pickupState = 'FL',
  dropoffState = 'FL',
): QuoteLeg => ({
  distanceMeters: miles(mi),
  pickupState,
  dropoffState,
});

const priced = (quote: ReturnType<typeof quoteTrip>) => {
  if (quote.kind !== 'priced')
    throw new Error(`Expected a price, got ${quote.reason}`);
  return quote;
};

describe('quoteTrip', () => {
  describe('rate card prices', () => {
    it.each([
      ['ambulatory', AMBULATORY, 10, 5000 + 3500],
      ['wheelchair', WHEELCHAIR, 10, 7500 + 4000],
      ['bariatric wheelchair', BARIATRIC, 10, 12500 + 4000],
      ['stretcher', STRETCHER, 10, 17500 + 5000],
    ])('%s one-way, %i miles', (_label, rates, mi, expected) => {
      const quote = priced(
        quoteTrip(
          { tripKind: TripKind.ONE_WAY, legs: [leg(mi)] },
          rates,
          LIMITS,
        ),
      );

      expect(quote.totalCents).toBe(expected);
      expect(quote.billableMiles).toBe(mi);
    });

    it('round trip uses the round-trip base and both legs’ miles', () => {
      // Wheelchair, 8 mi there + 8 mi back = 16 mi.
      const quote = priced(
        quoteTrip(
          { tripKind: TripKind.ROUND_TRIP, legs: [leg(8), leg(8)] },
          WHEELCHAIR,
          LIMITS,
        ),
      );

      expect(quote.lines).toEqual([
        {
          type: ChargeType.BASE_FARE,
          description: 'Base fare (round trip)',
          amountCents: 15000,
        },
        {
          type: ChargeType.MILEAGE,
          description: 'Mileage: 16.0 mi × $4.00',
          quantity: 16,
          amountCents: 6400,
        },
      ]);
      expect(quote.totalCents).toBe(21400);
    });

    it('prices wait-and-return like a round trip', () => {
      const roundTrip = quoteTrip(
        { tripKind: TripKind.ROUND_TRIP, legs: [leg(5), leg(5)] },
        AMBULATORY,
        LIMITS,
      );
      const waitAndReturn = quoteTrip(
        { tripKind: TripKind.WAIT_AND_RETURN, legs: [leg(5), leg(5)] },
        AMBULATORY,
        LIMITS,
      );

      expect(priced(waitAndReturn).totalCents).toBe(
        priced(roundTrip).totalCents,
      );
      expect(priced(waitAndReturn).lines[0].description).toBe(
        'Base fare (wait and return)',
      );
    });

    it('bills different return distances by their real total', () => {
      const quote = priced(
        quoteTrip(
          { tripKind: TripKind.ROUND_TRIP, legs: [leg(6.2), leg(7.1)] },
          AMBULATORY,
          LIMITS,
        ),
      );

      expect(quote.billableMiles).toBe(13.3);
      expect(quote.totalCents).toBe(10000 + Math.round(133 * 35)); // $146.55
    });

    it('always totals the sum of its lines', () => {
      const quote = priced(
        quoteTrip(
          { tripKind: TripKind.ROUND_TRIP, legs: [leg(3.37), leg(4.91)] },
          BARIATRIC,
          LIMITS,
        ),
      );

      expect(quote.totalCents).toBe(totalOf(quote.lines));
    });
  });

  describe('mileage rounding', () => {
    it('rounds up to the next tenth of a mile', () => {
      expect(billableTenths(miles(10))).toBe(100);
      expect(billableTenths(miles(10.01))).toBe(101);
      expect(billableTenths(miles(10.09))).toBe(101);
      expect(billableTenths(1)).toBe(1); // 1 meter = 0.1 mi
      expect(billableTenths(0)).toBe(0);
    });

    it('does not add a tenth for float noise on exact distances', () => {
      for (const mi of [0.1, 0.3, 1.1, 2.7, 12.3, 49.9, 50]) {
        expect(billableTenths(miles(mi))).toBe(Math.round(mi * 10));
      }
    });

    it('charges mileage on rounded miles, to the cent', () => {
      // 3.21 mi → 3.3 mi × $3.50 = $11.55
      const quote = priced(
        quoteTrip(
          { tripKind: TripKind.ONE_WAY, legs: [leg(3.21)] },
          AMBULATORY,
          LIMITS,
        ),
      );

      expect(quote.lines[1]).toMatchObject({
        quantity: 3.3,
        amountCents: 1155,
      });
    });

    it('charges only the base fare for a zero-distance trip', () => {
      const quote = priced(
        quoteTrip(
          { tripKind: TripKind.ONE_WAY, legs: [leg(0)] },
          WHEELCHAIR,
          LIMITS,
        ),
      );

      expect(quote.totalCents).toBe(7500);
    });
  });

  describe('call for a quote', () => {
    it('allows a leg of exactly 50 miles', () => {
      expect(
        quoteTrip(
          { tripKind: TripKind.ONE_WAY, legs: [leg(50)] },
          AMBULATORY,
          LIMITS,
        ).kind,
      ).toBe('priced');
    });

    it('sends any leg over 50 miles to a custom quote', () => {
      expect(
        quoteTrip(
          { tripKind: TripKind.ONE_WAY, legs: [leg(50.05)] },
          AMBULATORY,
          LIMITS,
        ),
      ).toEqual({ kind: 'call_for_quote', reason: 'LONG_DISTANCE' });
    });

    it('judges the limit per leg, not the round-trip total', () => {
      // 40 + 40 = 80 mi total, but neither leg is over 50.
      expect(
        quoteTrip(
          { tripKind: TripKind.ROUND_TRIP, legs: [leg(40), leg(40)] },
          AMBULATORY,
          LIMITS,
        ).kind,
      ).toBe('priced');
    });

    it('sends trips with an out-of-state address to a custom quote', () => {
      expect(
        quoteTrip(
          { tripKind: TripKind.ONE_WAY, legs: [leg(10, 'FL', 'GA')] },
          AMBULATORY,
          LIMITS,
        ),
      ).toEqual({ kind: 'call_for_quote', reason: 'OUT_OF_STATE' });
    });

    it('accepts lowercase state codes', () => {
      expect(
        quoteTrip(
          { tripKind: TripKind.ONE_WAY, legs: [leg(10, 'fl', 'Fl')] },
          AMBULATORY,
          LIMITS,
        ).kind,
      ).toBe('priced');
    });

    it('asks for a custom quote when the care level has no rates', () => {
      expect(
        quoteTrip(
          { tripKind: TripKind.ONE_WAY, legs: [leg(10)] },
          null,
          LIMITS,
        ),
      ).toEqual({ kind: 'call_for_quote', reason: 'NO_RATE' });
    });
  });

  describe('input checks', () => {
    it('requires one leg for one-way and two for round trips', () => {
      expect(() =>
        quoteTrip(
          { tripKind: TripKind.ONE_WAY, legs: [leg(1), leg(1)] },
          AMBULATORY,
          LIMITS,
        ),
      ).toThrow(/needs 1 leg/);
      expect(() =>
        quoteTrip(
          { tripKind: TripKind.ROUND_TRIP, legs: [leg(1)] },
          AMBULATORY,
          LIMITS,
        ),
      ).toThrow(/needs 2 leg/);
    });

    it('rejects negative or missing distances', () => {
      expect(() =>
        quoteTrip(
          {
            tripKind: TripKind.ONE_WAY,
            legs: [
              { distanceMeters: -5, pickupState: 'FL', dropoffState: 'FL' },
            ],
          },
          AMBULATORY,
          LIMITS,
        ),
      ).toThrow(/Invalid leg distance/);
      expect(() =>
        quoteTrip(
          {
            tripKind: TripKind.ONE_WAY,
            legs: [
              { distanceMeters: NaN, pickupState: 'FL', dropoffState: 'FL' },
            ],
          },
          AMBULATORY,
          LIMITS,
        ),
      ).toThrow(/Invalid leg distance/);
    });
  });
});

describe('waitTimeCharge', () => {
  it.each([
    [0, 0],
    [15, 0], // grace period
    [16, 1500], // 1 started block
    [30, 1500],
    [31, 3000], // 2 started blocks
    [35, 3000], // 20 min past grace = 2 blocks ($30)
    [45, 3000],
    [46, 4500],
    [75, 6000],
  ])('%i minutes waited costs %i cents', (waited, cents) => {
    expect(waitTimeCharge(waited, WHEELCHAIR)?.amountCents ?? 0).toBe(cents);
  });

  it('describes the blocks charged', () => {
    expect(waitTimeCharge(35, AMBULATORY)).toEqual({
      type: ChargeType.WAIT_TIME,
      description: 'Waiting time: 2 × 15 min after a 15-min grace period',
      quantity: 2,
      amountCents: 3000,
    });
  });

  it('rejects negative minutes', () => {
    expect(() => waitTimeCharge(-1, AMBULATORY)).toThrow(
      /Invalid waited minutes/,
    );
  });
});

describe('fees', () => {
  it.each([
    ['ambulatory', AMBULATORY, 5000, 2500],
    ['wheelchair', WHEELCHAIR, 7500, 3750],
    ['bariatric wheelchair', BARIATRIC, 12500, 6250],
    ['stretcher', STRETCHER, 17500, 8750],
  ])('%s no-show and late-cancellation fees', (_label, rates, noShow, late) => {
    expect(noShowCharge(rates)).toEqual({
      type: ChargeType.NO_SHOW,
      description: 'No-show fee',
      amountCents: noShow,
    });
    expect(lateCancellationCharge(rates)).toEqual({
      type: ChargeType.LATE_CANCELLATION,
      description: 'Late cancellation fee',
      amountCents: late,
    });
  });
});
