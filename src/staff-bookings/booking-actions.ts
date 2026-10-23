import {
  BookingStatus,
  PaymentStatus,
  type PricingRule,
} from '../generated/prisma/client.js';

const MINUTE_MS = 60 * 1000;

// What staff can do to a booking right now (docs/plan.md → Status rules).
// The API enforces the same rules; the website uses this to decide which
// buttons to show.
export type StaffActions = {
  confirm: boolean;
  // feeCents: the late-cancellation fee if it's cancelled now, else null.
  cancel: { allowed: boolean; feeCents: number | null };
  // Only after the grace period past the pickup time.
  noShow: { allowed: boolean; availableAt: string | null; feeCents: number };
  // Only once the pickup time has come.
  complete: { allowed: boolean; availableAt: string | null };
  // A charge was declined or got no answer.
  retryCharge: boolean;
};

export type ActionInput = {
  status: BookingStatus;
  outboundPickupAt: Date;
  paymentStatus: PaymentStatus | null;
  rule: Pick<
    PricingRule,
    'waitGraceMinutes' | 'noShowFeeCents' | 'lateCancelFeeCents'
  >;
  lateCancelWindowMinutes: number;
  now: Date;
};

const FINAL: BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.NO_SHOW,
  BookingStatus.CANCELLED,
];

// Cancelling a confirmed ride inside the window before pickup costs the
// late-cancellation fee. Unconfirmed requests can always be cancelled free:
// Lade hadn't committed to them yet.
export const lateCancelFee = (input: ActionInput): number | null => {
  if (input.status !== BookingStatus.CONFIRMED) return null;
  const windowStart =
    input.outboundPickupAt.getTime() -
    input.lateCancelWindowMinutes * MINUTE_MS;
  return input.now.getTime() >= windowStart
    ? input.rule.lateCancelFeeCents
    : null;
};

export const noShowAvailableAt = (input: ActionInput) =>
  new Date(
    input.outboundPickupAt.getTime() + input.rule.waitGraceMinutes * MINUTE_MS,
  );

export const staffActions = (input: ActionInput): StaffActions => {
  const confirmed = input.status === BookingStatus.CONFIRMED;
  const noShowAt = noShowAvailableAt(input);

  return {
    confirm: input.status === BookingStatus.REQUESTED,
    cancel: {
      allowed:
        input.status === BookingStatus.REQUESTED ||
        input.status === BookingStatus.CONFIRMED,
      feeCents: lateCancelFee(input),
    },
    noShow: {
      allowed: confirmed && input.now >= noShowAt,
      availableAt: confirmed ? noShowAt.toISOString() : null,
      feeCents: input.rule.noShowFeeCents,
    },
    complete: {
      allowed: confirmed && input.now >= input.outboundPickupAt,
      availableAt: confirmed ? input.outboundPickupAt.toISOString() : null,
    },
    retryCharge:
      FINAL.includes(input.status) &&
      (input.paymentStatus === PaymentStatus.FAILED ||
        input.paymentStatus === PaymentStatus.CHARGE_PENDING),
  };
};
