import { BookingStatus, PaymentStatus } from '../generated/prisma/client.js';
import { staffActions, type ActionInput } from './booking-actions.js';

const PICKUP = new Date('2026-10-21T14:00:00Z');
const minutes = (n: number) => new Date(PICKUP.getTime() + n * 60 * 1000);

const input = (overrides: Partial<ActionInput> = {}): ActionInput => ({
  status: BookingStatus.CONFIRMED,
  outboundPickupAt: PICKUP,
  paymentStatus: PaymentStatus.CARD_SAVED,
  rule: {
    waitGraceMinutes: 15,
    noShowFeeCents: 7500,
    lateCancelFeeCents: 3750,
  },
  lateCancelWindowMinutes: 120,
  now: minutes(-24 * 60),
  ...overrides,
});

describe('staffActions', () => {
  it('lets staff confirm or decline a new request, free', () => {
    const actions = staffActions(input({ status: BookingStatus.REQUESTED }));
    expect(actions.confirm).toBe(true);
    // Even close to pickup: Lade never committed to it.
    expect(
      staffActions(
        input({ status: BookingStatus.REQUESTED, now: minutes(-10) }),
      ).cancel,
    ).toEqual({ allowed: true, feeCents: null });
    expect(actions.complete.allowed).toBe(false);
    expect(actions.noShow.allowed).toBe(false);
  });

  it('charges the late-cancel fee from 2 hours before pickup', () => {
    expect(
      staffActions(input({ now: minutes(-121) })).cancel.feeCents,
    ).toBeNull();
    expect(staffActions(input({ now: minutes(-120) })).cancel.feeCents).toBe(
      3750,
    );
    expect(staffActions(input({ now: minutes(30) })).cancel.feeCents).toBe(
      3750,
    );
  });

  it('allows a no-show only after the 15-minute grace period', () => {
    expect(staffActions(input({ now: minutes(14) })).noShow).toEqual({
      allowed: false,
      availableAt: minutes(15).toISOString(),
      feeCents: 7500,
    });
    expect(staffActions(input({ now: minutes(15) })).noShow.allowed).toBe(true);
  });

  it('allows completing once the pickup time has come', () => {
    expect(staffActions(input({ now: minutes(-1) })).complete.allowed).toBe(
      false,
    );
    expect(staffActions(input({ now: minutes(0) })).complete).toEqual({
      allowed: true,
      availableAt: PICKUP.toISOString(),
    });
  });

  it('offers nothing but a charge retry once the booking is final', () => {
    for (const status of [
      BookingStatus.COMPLETED,
      BookingStatus.NO_SHOW,
      BookingStatus.CANCELLED,
    ]) {
      const actions = staffActions(
        input({
          status,
          paymentStatus: PaymentStatus.FAILED,
          now: minutes(60),
        }),
      );
      expect(actions).toMatchObject({
        confirm: false,
        cancel: { allowed: false },
        noShow: { allowed: false },
        complete: { allowed: false },
        retryCharge: true,
      });
    }
    expect(
      staffActions(
        input({
          status: BookingStatus.COMPLETED,
          paymentStatus: PaymentStatus.CHARGED,
        }),
      ).retryCharge,
    ).toBe(false);
  });
});
