import { formatCents } from '../pricing/pricing.js';
import type { MailMessage } from './mailer.js';

// Plain-text booking emails. No PHI beyond what the recipient already knows
// is theirs: only the booking reference and amounts. Never the rider's name,
// addresses, pickup times, care level or anything medical, because email
// leaves our systems. Details are one sign-in away on the website.

const signature = '\n\nLade Health Care Services';

export const requestReceived = (
  to: string,
  reference: string,
  accountLink: string,
): MailMessage => ({
  to,
  subject: `We received your ride request ${reference}`,
  text:
    `Thank you. We received your ride request ${reference} and saved your card. ` +
    `It isn't charged until after the ride.\n\n` +
    `We'll email you again once we've confirmed it. To see the details, sign in:\n\n${accountLink}` +
    signature,
});

export const staffNewRequest = (
  to: string,
  reference: string,
  bookingLink: string,
): MailMessage => ({
  to,
  subject: `New ride request ${reference}`,
  text:
    `A new ride request (${reference}) is waiting for confirmation.\n\n` +
    `Sign in to review it:\n\n${bookingLink}` +
    signature,
});

export const staffRideCancelled = (
  to: string,
  reference: string,
  bookingLink: string,
): MailMessage => ({
  to,
  subject: `Ride ${reference} was cancelled by the customer`,
  text:
    `The customer cancelled ride ${reference}. Any late-cancellation fee has ` +
    `been charged automatically.\n\nDetails:\n\n${bookingLink}` +
    signature,
});

export const rideConfirmed = (
  to: string,
  reference: string,
  accountLink: string,
): MailMessage => ({
  to,
  subject: `Your ride ${reference} is confirmed`,
  text:
    `Good news: your ride ${reference} is confirmed.\n\n` +
    `To see the details, sign in:\n\n${accountLink}` +
    signature,
});

// fee: null when nothing is owed; charged: whether the card took it.
export type Fee = { cents: number; charged: boolean } | null;

const feeSentence = (fee: Fee, what: string) =>
  !fee
    ? ` You haven't been charged.`
    : fee.charged
      ? ` A ${what} fee of ${formatCents(fee.cents)} was charged to your card on file.`
      : ` A ${what} fee of ${formatCents(fee.cents)} applies.`;

export const rideCancelled = (
  to: string,
  reference: string,
  fee: Fee,
  accountLink: string,
): MailMessage => ({
  to,
  subject: `Your ride ${reference} was cancelled`,
  text:
    `Your ride ${reference} has been cancelled.` +
    feeSentence(fee, 'late-cancellation') +
    (fee ? ` (It was cancelled less than 2 hours before pickup.)` : '') +
    `\n\nIf you didn't expect this, please contact us. Your bookings:\n\n${accountLink}` +
    signature,
});

export const noShow = (
  to: string,
  reference: string,
  fee: Fee,
  accountLink: string,
): MailMessage => ({
  to,
  subject: `Missed pickup for ride ${reference}`,
  text:
    `Our driver couldn't find the rider at the pickup for ride ${reference}, ` +
    `so it was recorded as a no-show and any ride back was cancelled.` +
    feeSentence(fee, 'no-show') +
    `\n\nIf you think this is a mistake, please contact us. Your bookings:\n\n${accountLink}` +
    signature,
});

export const receipt = (
  to: string,
  reference: string,
  amountCents: number,
  accountLink: string,
): MailMessage => ({
  to,
  subject: `Receipt for ride ${reference}`,
  text:
    `Thank you for riding with us. We charged ${formatCents(amountCents)} ` +
    `to your card on file for ride ${reference}.\n\n` +
    `To see the charges line by line, sign in:\n\n${accountLink}` +
    signature,
});

export const chargeFailed = (
  to: string,
  reference: string,
  amountCents: number,
  contactLink: string,
): MailMessage => ({
  to,
  subject: `We couldn't charge your card for ride ${reference}`,
  text:
    `We tried to charge ${formatCents(amountCents)} to your card on file for ` +
    `ride ${reference}, but it didn't go through. Your bank may have declined it ` +
    `or asked for approval.\n\n` +
    `Please contact us so we can sort it out:\n\n${contactLink}` +
    signature,
});
