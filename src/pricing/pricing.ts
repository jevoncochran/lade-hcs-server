// Pricing rules from Lade's rate card (docs/plan.md → Pricing). Pure
// functions: no database, no clock, so every rule is easy to test exactly.
// All money is integer cents.

import { ChargeType, TripKind } from '../generated/prisma/client.js';

export const METERS_PER_MILE = 1609.344;

// Rates for one care level (a PricingRule row).
export type Rates = {
  oneWayBaseCents: number;
  roundTripBaseCents: number;
  perMileCents: number;
  waitGraceMinutes: number;
  waitIncrementMinutes: number;
  waitIncrementCents: number;
  noShowFeeCents: number;
  lateCancelFeeCents: number;
};

export type QuoteLeg = {
  distanceMeters: number;
  pickupState: string; // two-letter, e.g. "FL"
  dropoffState: string;
};

export type QuoteInput = {
  tripKind: TripKind;
  // Outbound first; round trips and wait-and-return trips also have a return leg.
  legs: QuoteLeg[];
};

export type PricingLimits = {
  longDistanceMaxMiles: number; // a leg longer than this needs a custom quote
  serviceState: string; // trips outside this state need a custom quote
};

export type PriceLine = {
  type: ChargeType;
  description: string;
  quantity?: number; // miles, or 15-minute blocks
  amountCents: number;
};

export type CallForQuoteReason = 'LONG_DISTANCE' | 'OUT_OF_STATE' | 'NO_RATE';

export type Quote =
  | {
      kind: 'priced';
      lines: PriceLine[];
      totalCents: number;
      billableMiles: number;
    }
  | { kind: 'call_for_quote'; reason: CallForQuoteReason };

export const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Billable miles round UP to the next tenth of a mile, like a taxi meter:
// 10.01 mi is billed as 10.1. Returned in tenths to keep the math exact.
export const billableTenths = (meters: number) =>
  // The small tolerance stops float noise (e.g. 16093.44 m → 100.0000001
  // tenths) from adding a tenth that isn't really there.
  // Math.max: with the tolerance, 0 m would otherwise give -0.
  Math.max(0, Math.ceil(meters / (METERS_PER_MILE / 10) - 1e-9));

const isRoundTrip = (tripKind: TripKind) => tripKind !== TripKind.ONE_WAY;

const expectedLegs = (tripKind: TripKind) => (isRoundTrip(tripKind) ? 2 : 1);

const TRIP_LABEL: Record<TripKind, string> = {
  ONE_WAY: 'one-way',
  ROUND_TRIP: 'round trip',
  WAIT_AND_RETURN: 'wait and return',
};

// The price shown at booking: base fare + mileage. Waiting time is unknown
// until the ride, so it's charged afterwards (see waitTimeCharge).
//
// Returns "call for a quote" instead of a price when a leg is longer than the
// long-distance limit, an address is outside the service state, or there are
// no rates for the care level yet (e.g. stretcher before Lade sets a price).
export const quoteTrip = (
  input: QuoteInput,
  rates: Rates | null,
  limits: PricingLimits,
): Quote => {
  if (input.legs.length !== expectedLegs(input.tripKind)) {
    throw new Error(
      `A ${TRIP_LABEL[input.tripKind]} trip needs ${expectedLegs(input.tripKind)} leg(s), got ${input.legs.length}`,
    );
  }
  for (const leg of input.legs) {
    if (!Number.isFinite(leg.distanceMeters) || leg.distanceMeters < 0) {
      throw new Error(`Invalid leg distance: ${leg.distanceMeters}`);
    }
  }

  const outOfState = input.legs.some(
    (leg) =>
      leg.pickupState.toUpperCase() !== limits.serviceState ||
      leg.dropoffState.toUpperCase() !== limits.serviceState,
  );
  if (outOfState) return { kind: 'call_for_quote', reason: 'OUT_OF_STATE' };

  const longDistance = input.legs.some(
    (leg) =>
      billableTenths(leg.distanceMeters) > limits.longDistanceMaxMiles * 10,
  );
  if (longDistance) return { kind: 'call_for_quote', reason: 'LONG_DISTANCE' };

  if (!rates) return { kind: 'call_for_quote', reason: 'NO_RATE' };

  const fare = fareLines(
    input.tripKind,
    input.legs.map((leg) => leg.distanceMeters),
    rates,
  );
  return { kind: 'priced', ...fare };
};

// Base fare + mileage. Round trips bill the total passenger miles of both
// legs together.
const fareLines = (
  tripKind: TripKind,
  legMeters: number[],
  rates: Rates,
): { lines: PriceLine[]; totalCents: number; billableMiles: number } => {
  const baseCents = isRoundTrip(tripKind)
    ? rates.roundTripBaseCents
    : rates.oneWayBaseCents;
  const totalMeters = legMeters.reduce((sum, meters) => sum + meters, 0);
  const tenths = billableTenths(totalMeters);
  const mileageCents = Math.round((tenths * rates.perMileCents) / 10);
  const miles = tenths / 10;

  return {
    lines: [
      {
        type: ChargeType.BASE_FARE,
        description: `Base fare (${TRIP_LABEL[tripKind]})`,
        amountCents: baseCents,
      },
      {
        type: ChargeType.MILEAGE,
        description: `Mileage: ${miles.toFixed(1)} mi × ${formatCents(rates.perMileCents)}`,
        quantity: miles,
        amountCents: mileageCents,
      },
    ],
    totalCents: baseCents + mileageCents,
    billableMiles: miles,
  };
};

// Charged after the ride for one stop where the driver waited. The first
// 15 minutes are free; after that every started 15-minute block counts in
// full (20 minutes of waiting past the grace period is 2 blocks).
export const waitTimeCharge = (
  waitedMinutes: number,
  rates: Rates,
  // Which stop, when a trip has more than one, e.g. "ride back".
  where?: string,
): PriceLine | null => {
  if (!Number.isFinite(waitedMinutes) || waitedMinutes < 0) {
    throw new Error(`Invalid waited minutes: ${waitedMinutes}`);
  }
  const billable = waitedMinutes - rates.waitGraceMinutes;
  if (billable <= 0) return null;

  const blocks = Math.ceil(billable / rates.waitIncrementMinutes);
  return {
    type: ChargeType.WAIT_TIME,
    description: `Waiting time${where ? ` (${where})` : ''}: ${blocks} × ${rates.waitIncrementMinutes} min after a ${rates.waitGraceMinutes}-min grace period`,
    quantity: blocks,
    amountCents: blocks * rates.waitIncrementCents,
  };
};

// A leg the rider actually rode, with the minutes the driver waited.
export type RiddenLeg = {
  distanceMeters: number;
  waitedMinutes: number | null;
  label: string; // "ride there" / "ride back"
  legId?: string; // passed through to that leg's waiting-time line
};

// What a finished ride costs: base fare + mileage for the legs that
// happened, plus waiting time. A round trip whose ride back wasn't needed is
// billed as one-way, with no mileage for the leg that didn't happen.
export const completedRideCharges = (
  tripKind: TripKind,
  ridden: RiddenLeg[],
  rates: Rates,
): (PriceLine & { legId?: string })[] => {
  if (ridden.length === 0 || ridden.length > expectedLegs(tripKind)) {
    throw new Error(`Invalid number of ridden legs: ${ridden.length}`);
  }
  const billedAs =
    ridden.length < expectedLegs(tripKind) ? TripKind.ONE_WAY : tripKind;
  const fare = fareLines(
    billedAs,
    ridden.map((leg) => leg.distanceMeters),
    rates,
  );
  const waits = ridden.flatMap((leg) => {
    const line =
      leg.waitedMinutes === null
        ? null
        : waitTimeCharge(
            leg.waitedMinutes,
            rates,
            ridden.length > 1 ? leg.label : undefined,
          );
    return line ? [{ ...line, legId: leg.legId }] : [];
  });

  return [...fare.lines, ...waits];
};

// Rider not there at pickup (after the grace period). No mileage is ever
// charged for a trip that didn't happen.
export const noShowCharge = (rates: Rates): PriceLine => ({
  type: ChargeType.NO_SHOW,
  description: 'No-show fee',
  amountCents: rates.noShowFeeCents,
});

// Cancelled inside the late-cancellation window (2 hours before pickup).
export const lateCancellationCharge = (rates: Rates): PriceLine => ({
  type: ChargeType.LATE_CANCELLATION,
  description: 'Late cancellation fee',
  amountCents: rates.lateCancelFeeCents,
});

export const totalOf = (lines: PriceLine[]) =>
  lines.reduce((sum, line) => sum + line.amountCents, 0);
