import type Stripe from 'stripe';
import { StripePaymentGateway } from './stripe-payment.gateway.js';

const input = {
  paymentCustomerId: 'cus_1',
  paymentMethodId: 'pm_1',
  amountCents: 11500,
  currency: 'usd',
  bookingId: 'booking-1',
  idempotencyKey: 'charge-p1-1',
};

// A Stripe client whose paymentIntents.create does `create`.
const gatewayWith = (create: (...args: unknown[]) => Promise<unknown>) => {
  const calls: unknown[][] = [];
  const stripe = {
    paymentIntents: {
      create: (...args: unknown[]) => {
        calls.push(args);
        return create(...args);
      },
    },
  } as unknown as Stripe;
  return { gateway: new StripePaymentGateway(stripe), calls };
};

describe('StripePaymentGateway.chargeSavedCard', () => {
  it('charges off-session with the idempotency key and only our id', async () => {
    const { gateway, calls } = gatewayWith(async () => ({
      id: 'pi_1',
      status: 'succeeded',
    }));

    expect(await gateway.chargeSavedCard(input)).toEqual({
      status: 'charged',
      paymentIntentId: 'pi_1',
    });
    expect(calls[0]).toEqual([
      {
        amount: 11500,
        currency: 'usd',
        customer: 'cus_1',
        payment_method: 'pm_1',
        off_session: true,
        confirm: true,
        metadata: { bookingId: 'booking-1' },
      },
      { idempotencyKey: 'charge-p1-1' },
    ]);
  });

  it('reports a decline with its reason', async () => {
    const { gateway } = gatewayWith(async () => {
      throw Object.assign(new Error('Your card was declined.'), {
        type: 'StripeCardError',
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        payment_intent: { id: 'pi_2' },
      });
    });
    expect(await gateway.chargeSavedCard(input)).toEqual({
      status: 'failed',
      code: 'insufficient_funds',
      paymentIntentId: 'pi_2',
    });
  });

  it('reports a bank asking for approval as failed', async () => {
    const { gateway } = gatewayWith(async () => ({
      id: 'pi_3',
      status: 'requires_action',
    }));
    expect(await gateway.chargeSavedCard(input)).toEqual({
      status: 'failed',
      code: 'requires_action',
      paymentIntentId: 'pi_3',
    });
  });

  it("throws when there's no answer, so the charge stays retryable", async () => {
    const { gateway } = gatewayWith(async () => {
      throw Object.assign(new Error('socket hang up'), {
        type: 'StripeConnectionError',
      });
    });
    await expect(gateway.chargeSavedCard(input)).rejects.toThrow(
      'socket hang up',
    );
  });
});
