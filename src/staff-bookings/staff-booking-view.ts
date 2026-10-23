import {
  sortLegs,
  toBookingView,
  type BookingView,
} from '../bookings/booking-view.js';
import type {
  ActorType,
  Booking,
  BookingCharge,
  BookingEvent,
  ChargeType,
  BookingStatus,
  CareLevel,
  LegDirection,
  LegStatus,
  Payment,
  PaymentStatus,
  RequesterRelationship,
  TripKind,
  TripLeg,
  TripType,
} from '../generated/prisma/client.js';
import type { Address } from '../mileage/address.js';
import type { StaffActions } from './booking-actions.js';

// One row of the staff booking list: enough to dispatch from, without the
// notes, requester details and price lines (open the booking for those).
export type StaffBookingSummary = {
  id: string;
  reference: string;
  status: BookingStatus;
  careLevel: CareLevel;
  tripKind: TripKind;
  tripType: TripType;
  rider: { firstName: string; lastName: string };
  pickupAt: string;
  pickup: Address;
  dropoff: Address;
  // Round trips only.
  returnLeg: { pickupAt: string | null; willCall: boolean } | null;
  totalCents: number;
  paymentStatus: PaymentStatus | null;
  createdAt: string;
};

// Everything about one booking, for staff. Adds what the customer view
// leaves out: who booked it, payment state, leg progress and history.
export type StaffBookingView = Omit<BookingView, 'legs'> & {
  customerId: string | null;
  requester: {
    relationship: RequesterRelationship;
    name: string;
    email: string;
    phone: string;
  };
  legs: (BookingView['legs'][number] & {
    status: LegStatus;
    waitedMinutes: number | null;
    distanceMeters: number;
  })[];
  payment: {
    status: PaymentStatus;
    amountCents: number;
    refundedCents: number;
    failureCode: string | null;
  } | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  // What the booking owes so far, line by line (what gets charged).
  charges: {
    type: ChargeType;
    leg: LegDirection | null;
    quantity: number | null; // miles, or 15-minute blocks
    amountCents: number;
    note: string | null;
    staffName: string | null;
    at: string;
  }[];
  chargesTotalCents: number;
  actions: StaffActions;
  history: {
    fromStatus: BookingStatus | null;
    toStatus: BookingStatus;
    actorType: ActorType;
    staffName: string | null;
    note: string | null;
    at: string;
  }[];
  updatedAt: string;
};

type WithLegsAndPayment = Booking & {
  legs: TripLeg[];
  payments: Payment[]; // newest first, at most one needed
};

const parseAddress = (json: string) => JSON.parse(json) as Address;

const paymentOf = (booking: WithLegsAndPayment) => booking.payments[0] ?? null;

export const toStaffBookingSummary = (
  booking: WithLegsAndPayment,
): StaffBookingSummary => {
  const [outbound, ret] = sortLegs(booking.legs);
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
    },
    // Outbound pickups always have a time; only the ride back can be will-call.
    pickupAt: outbound.pickupAt!.toISOString(),
    pickup: parseAddress(outbound.pickupAddress),
    dropoff: parseAddress(outbound.dropoffAddress),
    returnLeg: ret
      ? {
          pickupAt: ret.pickupAt?.toISOString() ?? null,
          willCall: ret.willCall,
        }
      : null,
    totalCents: booking.quotedPriceCents,
    paymentStatus: paymentOf(booking)?.status ?? null,
    createdAt: booking.createdAt.toISOString(),
  };
};

export type StaffBookingRecord = WithLegsAndPayment & {
  events: (BookingEvent & { staffUser: { name: string } | null })[];
  charges: (BookingCharge & {
    leg: { direction: LegDirection } | null;
    createdBy: { name: string } | null;
  })[];
};

export const toStaffBookingView = (
  booking: StaffBookingRecord,
  actions: StaffActions,
): StaffBookingView => {
  const base = toBookingView(booking);
  // toBookingView sorts the same way, so the legs line up.
  const legs = sortLegs(booking.legs);
  const payment = paymentOf(booking);

  return {
    ...base,
    customerId: booking.customerId,
    requester: {
      relationship: booking.requesterRelationship,
      name: booking.requesterName,
      email: booking.requesterEmail,
      phone: booking.requesterPhone,
    },
    legs: base.legs.map((leg, index) => ({
      ...leg,
      status: legs[index].status,
      waitedMinutes: legs[index].waitedMinutes,
      distanceMeters: legs[index].distanceMeters,
    })),
    payment: payment && {
      status: payment.status,
      amountCents: payment.amountCents,
      refundedCents: payment.refundedCents,
      failureCode: payment.failureCode,
    },
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    cancellationReason: booking.cancellationReason,
    charges: booking.charges.map((charge) => ({
      type: charge.type,
      leg: charge.leg?.direction ?? null,
      quantity: charge.quantity === null ? null : Number(charge.quantity),
      amountCents: charge.amountCents,
      note: charge.note,
      staffName: charge.createdBy?.name ?? null,
      at: charge.createdAt.toISOString(),
    })),
    chargesTotalCents: booking.charges.reduce(
      (sum, charge) => sum + charge.amountCents,
      0,
    ),
    actions,
    history: booking.events.map((event) => ({
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      actorType: event.actorType,
      staffName: event.staffUser?.name ?? null,
      note: event.note,
      at: event.createdAt.toISOString(),
    })),
    updatedAt: booking.updatedAt.toISOString(),
  };
};
