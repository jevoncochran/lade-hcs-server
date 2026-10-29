import type {
  Booking,
  BookingCharge,
  BookingStatus,
  CareLevel,
  ChargeType,
  LegDirection,
  LegStatus,
  Payment,
  PaymentStatus,
  TripKind,
  TripLeg,
  TripType,
} from '../generated/prisma/client.js';
import type { Address } from '../mileage/address.js';
import type { PriceLine } from '../pricing/pricing.js';

// What a customer sees of their own booking. Built from decrypted fields;
// only ever returned to the booking's owner.
export type BookingView = {
  id: string;
  reference: string;
  status: BookingStatus;
  careLevel: CareLevel;
  tripKind: TripKind;
  tripType: TripType;
  rider: { firstName: string; lastName: string; phone: string | null };
  companionCount: number;
  mobilityNotes: string | null;
  instructions: string | null;
  legs: {
    direction: LegDirection;
    pickupAt: string | null; // null while "will call"
    willCall: boolean;
    appointmentAt: string | null;
    expectedWaitMinutes: number | null;
    pickup: Address;
    dropoff: Address;
  }[];
  price: {
    currency: string;
    lines: PriceLine[];
    totalCents: number;
    billableMiles: number;
    distanceIsEstimate: boolean;
  };
  createdAt: string;
};

// Stored on the booking at checkout (Booking.priceBreakdown).
export type PriceSnapshot = {
  lines: PriceLine[];
  billableMiles: number;
  // True when priced from a development distance estimate.
  distanceIsEstimate?: boolean;
};

// Outbound first, then the ride back.
export const sortLegs = <Leg extends Pick<TripLeg, 'direction'>>(
  legs: Leg[],
): Leg[] => {
  const order = { OUTBOUND: 0, RETURN: 1 } as const;
  return [...legs].sort((a, b) => order[a.direction] - order[b.direction]);
};

export const toBookingView = (
  booking: Booking & { legs: TripLeg[] },
): BookingView => {
  const snapshot = booking.priceBreakdown as PriceSnapshot;
  const legs = sortLegs(booking.legs);

  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    careLevel: booking.careLevel,
    tripKind: booking.tripKind,
    tripType: booking.tripType,
    rider: {
      firstName: booking.riderFirstName,
      lastName: booking.riderLastName,
      phone: booking.riderPhone,
    },
    companionCount: booking.companionCount,
    mobilityNotes: booking.mobilityNotes,
    instructions: booking.instructions,
    legs: legs.map((leg) => ({
      direction: leg.direction,
      pickupAt: leg.pickupAt?.toISOString() ?? null,
      willCall: leg.willCall,
      appointmentAt: leg.appointmentAt?.toISOString() ?? null,
      expectedWaitMinutes: leg.waitMinutes,
      pickup: JSON.parse(leg.pickupAddress) as Address,
      dropoff: JSON.parse(leg.dropoffAddress) as Address,
    })),
    price: {
      currency: booking.currency,
      lines: snapshot.lines,
      totalCents: booking.quotedPriceCents,
      billableMiles: snapshot.billableMiles,
      distanceIsEstimate: snapshot.distanceIsEstimate ?? false,
    },
    createdAt: booking.createdAt.toISOString(),
  };
};

// A customer's own ride on "My rides": the booking plus how it went, what
// it cost in the end, and whether they can still cancel it themselves.
export type CustomerRideView = Omit<BookingView, 'legs'> & {
  legs: (BookingView['legs'][number] & { status: LegStatus })[];
  cancelledAt: string | null;
  // Final charges, once the ride happened (or a fee applied). Staff notes
  // (e.g. why a fee was waived) are left out.
  charges: {
    type: ChargeType;
    leg: LegDirection | null;
    quantity: number | null;
    amountCents: number;
  }[];
  chargesTotalCents: number;
  paymentStatus: PaymentStatus | null;
  // feeCents: the late-cancellation fee if they cancel now, else null.
  cancel: { allowed: boolean; feeCents: number | null };
};

export type CustomerRideRecord = Booking & {
  legs: TripLeg[];
  payments: Payment[]; // newest first
  charges: (BookingCharge & { leg: { direction: LegDirection } | null })[];
};

export const toCustomerRideView = (
  booking: CustomerRideRecord,
  cancel: CustomerRideView['cancel'],
): CustomerRideView => {
  const base = toBookingView(booking);
  const legs = sortLegs(booking.legs); // same order as base.legs
  return {
    ...base,
    legs: base.legs.map((leg, index) => ({
      ...leg,
      status: legs[index].status,
    })),
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    charges: booking.charges.map((charge) => ({
      type: charge.type,
      leg: charge.leg?.direction ?? null,
      quantity: charge.quantity === null ? null : Number(charge.quantity),
      amountCents: charge.amountCents,
    })),
    chargesTotalCents: booking.charges.reduce(
      (sum, charge) => sum + charge.amountCents,
      0,
    ),
    paymentStatus: booking.payments[0]?.status ?? null,
    cancel,
  };
};
