// Injection token for card payments. Implementations, chosen by
// PAYMENT_PROVIDER:
//   - StripePaymentGateway: Stripe (test keys in development)
//   - FakePaymentGateway: development stand-in, no outside calls
//
// Never send PHI to the payment provider: an email address and our own ids
// only. No names, addresses, trip or medical details, not even in metadata.
export abstract class PaymentGateway {
  abstract readonly provider: 'fake' | 'stripe';

  // A customer record at the provider, so saved cards can be reused.
  abstract createCustomer(input: {
    customerId: string;
    email: string;
  }): Promise<{ id: string }>;

  // Whether a saved customer id came from this provider. Ids from another
  // provider (e.g. the fake gateway, before Stripe was switched on) can't be
  // reused and get replaced.
  abstract ownsCustomerId(id: string): boolean;

  // Starts saving a card for later off-session charges (Stripe SetupIntent).
  // The website confirms it with the client secret in the provider's own card
  // form, so card numbers never touch our servers.
  abstract createCardSetup(input: {
    paymentCustomerId: string;
    bookingId: string;
  }): Promise<CardSetup>;

  // The same setup again, e.g. when the website resubmits a booking.
  abstract retrieveCardSetup(setupId: string): Promise<CardSetup>;

  // Asks the provider whether the card was saved. Never trust the browser's
  // word for it: this is how the server finds out for itself.
  abstract checkCardSetup(setupId: string): Promise<CardSetupResult>;

  // Charges a saved card without the customer present (after the ride).
  // The same idempotency key always gives the same result, so a retry after
  // a lost answer can never charge twice. Throws only when there's no answer
  // (network, provider outage): the charge may or may not have happened, and
  // retrying with the same key finds out.
  abstract chargeSavedCard(input: {
    paymentCustomerId: string;
    paymentMethodId: string;
    amountCents: number;
    currency: string;
    bookingId: string;
    idempotencyKey: string;
  }): Promise<ChargeResult>;

  // Removes a saved card that won't be charged (e.g. a declined request).
  abstract releaseCard(paymentMethodId: string): Promise<void>;
}

export type ChargeResult =
  | { status: 'charged'; paymentIntentId: string }
  // Declined, or the bank wants the customer to approve it (3-D Secure).
  // `code` is the provider's short reason, e.g. "card_declined".
  | { status: 'failed'; code: string; paymentIntentId: string | null };

export type CardSetup = { id: string; clientSecret: string };

export type CardSetupResult =
  | { status: 'saved'; paymentMethodId: string }
  // e.g. the bank is still confirming it
  | { status: 'pending' }
  // declined, or the customer hasn't entered a card yet
  | { status: 'failed' };
