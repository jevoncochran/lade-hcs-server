import type {
  Booking,
  BookingStatus,
  CareLevel,
  LegDirection,
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
