import type { BlindIndexKind } from '../crypto/blind-index.js';
import type { Prisma } from '../generated/prisma/client.js';

type ModelName = Prisma.ModelName;

// Fields stored encrypted. Must match the `/// @encrypted` markers in
// prisma/schema.prisma; encrypted-fields.spec.ts fails if they drift.
export const ENCRYPTED_FIELDS: Partial<Record<ModelName, readonly string[]>> = {
  Booking: [
    'requesterName',
    'requesterEmail',
    'requesterPhone',
    'riderName',
    'riderPhone',
    'mobilityNotes',
    'instructions',
    'cancellationReason',
  ],
  TripLeg: ['pickupAddress', 'dropoffAddress'],
  BookingCharge: ['note'],
  BookingEvent: ['note'],
  StaffUser: ['mfaSecret'],
};

// Search hashes the encryption extension derives from a plaintext field
// whenever that field is written. Never set these directly.
export const BLIND_INDEXES: Partial<
  Record<ModelName, Record<string, { source: string; kind: BlindIndexKind }>>
> = {
  Booking: {
    requesterEmailHash: { source: 'requesterEmail', kind: 'email' },
    requesterPhoneHash: { source: 'requesterPhone', kind: 'phone' },
    riderNameHash: { source: 'riderName', kind: 'name' },
  },
};

// Every relation field and the model it points to, so nested writes and
// included results are handled (e.g. creating a booking with its legs).
// Must list every relation in the schema; encrypted-fields.spec.ts checks it.
export const RELATIONS: Record<ModelName, Record<string, ModelName>> = {
  Booking: {
    pricingRule: 'PricingRule',
    legs: 'TripLeg',
    charges: 'BookingCharge',
    payments: 'Payment',
    events: 'BookingEvent',
  },
  TripLeg: { booking: 'Booking', charges: 'BookingCharge' },
  BookingCharge: { booking: 'Booking', leg: 'TripLeg', createdBy: 'StaffUser' },
  BookingEvent: { booking: 'Booking', staffUser: 'StaffUser' },
  Payment: { booking: 'Booking' },
  StripeEvent: {},
  PricingRule: { bookings: 'Booking' },
  StaffUser: {
    refreshTokens: 'RefreshToken',
    bookingEvents: 'BookingEvent',
    bookingCharges: 'BookingCharge',
    auditLogs: 'AuditLog',
    sentInvites: 'StaffInvite',
  },
  RefreshToken: { staffUser: 'StaffUser' },
  StaffInvite: { invitedBy: 'StaffUser' },
  AuditLog: { staffUser: 'StaffUser' },
};
