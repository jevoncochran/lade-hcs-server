# Lade HCS Booking Backend — Plan

Backend for online ride booking on the Lade Health Care Services website
(`lade-healthcare-services`, Next.js). Planning decisions as of 2026-10-09.

## Scope

Building phases 1–3 now:

1. **Foundation** — NestJS scaffold, Prisma schema + migrations, config, validation, health check, local Postgres.
2. **Ride requests** — quote + booking endpoints, Stripe card capture, `/book-a-ride` page on the site.
3. **Staff side** — staff auth and admin ride endpoints; admin screens at `/admin` in the existing Next.js site.

Later: 4. notifications (beyond the minimal alerts below), 5. recurring rides, 6. deploy hardening. Also later: Facility accounts with weekly invoicing, drivers/vehicles.

## Stack & hosting

- **API:** NestJS + Prisma (`@prisma/adapter-pg`) + Postgres. `class-validator` DTOs. Same patterns as `sololang-server`.
- **Hosting:** Google Cloud Run (API) + Cloud SQL Postgres (smallest tier to start). Google BAA (free) accepted in the console.
- **Secrets / keys:** Google Secret Manager + Cloud KMS.
- **Mileage:** AWS Location Service (route calculation) in a small separate AWS account with the AWS BAA (free) accepted. Pay per request.
- **Payments:** Stripe (SetupIntent + off-session PaymentIntent).
- **Email:** Amazon SES under the AWS BAA (customer email addresses are PHI). Development prints emails to the log (`MAIL_TRANSPORT=log`); the SES mailer is built before launch.
- **Domains:** API on a subdomain of the site's domain (e.g. `api.ladehealthcare.com`) so staff auth cookies work.
- **Estimated cost at launch:** ~$15–30/month. Upgrade path: bigger Cloud SQL tier (no SLA on the smallest), Cloud Run min-instances=1 to avoid cold starts, HA database later.

## HIPAA approach

Ride data (rider identity + trips to medical appointments, addresses, mobility needs) is PHI.

- Every vendor that stores or processes PHI signs a BAA: Google Cloud, AWS. Stripe and the email provider receive **no PHI**.
- Collect the minimum. No date of birth. Medicaid/insurance IDs not collected (to be revisited).
- PHI fields encrypted at the application layer (AES-256-GCM via a Prisma client extension in `src/prisma/encryption.extension.ts`). Searchable fields get an HMAC blind index, computed by the extension. Filtering or sorting on an encrypted field throws. Raw SQL bypasses encryption and must never touch PHI columns.
- Keys (`ENCRYPTION_KEYS`, `ENCRYPTION_ACTIVE_KEY_ID`, `BLIND_INDEX_KEY`) live in Google Secret Manager in production. **Launch requirement:** production keys backed up outside Google Cloud (e.g. a Lade-controlled password manager). Losing them makes all patient data permanently unreadable.
- PHI never written to logs, error trackers, emails, or Stripe metadata.
- Append-only `AuditLog` for PHI access, changes, exports and auth events (DB role has INSERT/SELECT only).
- Staff MFA required, 15-minute idle logout.
- Dev/staging use seeded fake data only — never real PHI.
- Soft delete + retention purge job (retention period TBD — see Open items).
- Jevon needs a BAA with Lade as the developer with system access.

## Pricing

Public online bookings use the partner rates for now (`PriceChannel.PUBLIC`).

| Care level | One-way base | Round-trip base | Per mile | No-show fee | Late-cancel fee |
|---|---|---|---|---|---|
| Ambulatory | $50 | $100 | $3.50 | $50 | $25 |
| Wheelchair | $75 | $150 | $4.00 | $75 | $37.50 |
| Bariatric wheelchair | $125 | $250 | $4.00 | $125 | $62.50 |
| Stretcher* | $175 | $350 | $5.00 | $175 | $87.50 |

\*Stretcher rate and all no-show / late-cancel fees are **proposed** — pending Lade sign-off. The current rate card says stretcher is "not offered"; Lade is keeping the service and the rate card needs updating.

Rules:

- Round trip and wait-and-return use the round-trip base fare; mileage = total billable passenger miles for both legs.
- Billable miles round **up** to the next tenth of a mile (10.01 mi → 10.1 mi); mileage is rounded to the cent.
- The quote at booking is base fare + mileage. Waiting time is added after the ride.
- Engine: `src/pricing/pricing.ts` (pure, fully unit-tested); `PricingService` picks the rule in effect (newest started, not ended).
- **Wait time:** $15 per 15 minutes after a 15-minute grace period; partial increments round up to a full 15 minutes.
- No charge for companions/escorts. No after-hours or holiday surcharge. Service is 24/7 including holidays.
- **No-show:** rider not present at pickup. Can only be marked after the 15-minute grace period. Fee = one-way base fare. The return leg is cancelled free.
- **Late cancellation:** cancelled < 2 hours before pickup (or after driver dispatched). Fee = 50% of one-way base fare. Will-call return legs can't be late-cancelled.
- No mileage charged for trips that didn't happen. Admins can waive any fee (recorded as `ADJUSTMENT` with a note).
- If no `PricingRule` exists for a care level, the quote returns "call for a quote" (lets stretcher be switched on by adding a row).

## Booking rules (config values)

| Setting | Value |
|---|---|
| `MIN_NOTICE_HOURS` | 24 (all trips, including long distance) |
| `LONG_DISTANCE_MAX_MILES` | 50 per leg — above this, "call for a quote" |
| Out-of-state addresses | "Call for a quote" |
| `LATE_CANCEL_WINDOW_MINUTES` | 120 |
| `WAIT_GRACE_MINUTES` / increment | 15 / 15 |
| Pending-payment expiry | 1 hour |
| Business time zone | America/New_York (store UTC) |
| Service-area check | None for now |

## Booking & payment flow

1. `POST /quotes` (signed-in customers) → price breakdown, or "call for a quote" with a reason (`SHORT_NOTICE` under 24h, `LONG_DISTANCE`, `OUT_OF_STATE`, `NO_RATE`) and a message to show. Body: care level, trip kind, pickup + drop-off address, pickup time (ISO with time zone). Nothing is stored; an unfindable address returns 422 with `field: pickup|dropoff`. Distances come from `DistanceProvider`. With `MILEAGE_PROVIDER=aws` (`AWS_REGION`, `AWS_LOCATION_API_KEY`: a Location Service API key allowing geo-places Autocomplete/GetPlace/Geocode and geo-routes CalculateRoutes, no referrer restriction), `AwsDistanceProvider` geocodes both addresses (street-level matches only) and uses the car route distance; AWS failures return 503 "try again or call". Address autofill: `GET /addresses/suggest?q=` and `GET /addresses/places/:placeId` (signed-in customers; AWS Places, chosen places fetched with IntendedUse Storage). Otherwise, `EstimatedDistanceProvider` estimates from ZIP codes only: straight line between the two ZIP centers (US Census 2025 ZCTA Gazetteer, Florida only, generated by `scripts/build-zip-centroids.ts`) × 1.3 road factor, minimum 1 mi within a ZIP. Quotes and bookings carry `distanceIsEstimate`, and the website labels those prices as approximate. Out-of-state addresses are refused before any distance lookup.
2. `POST /bookings` (signed-in customer with a confirmed email) → recalculates the price (never trusts the website), checks 24h notice and return times (round trip: set time or will-call; wait-and-return: optional expected wait), records terms consent, and in one transaction saves the booking (`PENDING_PAYMENT`, reference like `LD-7K3Q9X`), encrypted legs, payment row (`CARD_PENDING`), status event and audit entry. Card setup goes through `PaymentGateway` (stand-in `FakePaymentGateway` until Stripe keys exist; production refuses it). Returns the booking and `{ provider, clientSecret }`. Resubmitting with the same `idempotencyKey` returns the same booking; refusals use the quote reasons (422). Riders have first + last name; staff search by last name. `GET /bookings` lists the customer's bookings (not `PENDING_PAYMENT`); `GET /bookings/:id` (owner only, else 404).
   - Card step: Stripe's Payment Element on the website confirms the SetupIntent (`confirmSetup`, 3-D Secure in a pop-up), then the website calls `POST /bookings/:id/confirm-card`. The API asks Stripe itself (`checkCardSetup`) and only then calls `BookingsService.markCardSaved` (→ `REQUESTED`). Declined → 422; bank still confirming → stays `PENDING_PAYMENT`.
   - Backup: `POST /payments/stripe/webhook` (`setup_intent.succeeded`), signature-checked with `STRIPE_WEBHOOK_SECRET`, each event processed once (`StripeEvent`). Optional in development; required in production. Production setup: Stripe Dashboard → Webhooks → endpoint `https://<api>/payments/stripe/webhook`.
   - `PAYMENT_PROVIDER=stripe` with `STRIPE_SECRET_KEY` (sk_test_ in development, sk_live_ required in production); the website needs `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. `PAYMENT_PROVIDER=fake` still works locally without Stripe.
   - Website: `/book-a-ride` runs trip details → live quote / "call us" → review + terms → card (test mode) → confirmation; My Account lists the customer's rides.
3. Site confirms the card with the Stripe Payment Element. Webhook `setup_intent.succeeded` → booking `REQUESTED`, payment `CARD_SAVED`, PHI-free staff alert email.
4. Abandoned `PENDING_PAYMENT` bookings are deleted after 1 hour.
5. Staff confirm → `CONFIRMED` + confirmation email with manage link. Staff decline → `CANCELLED`, payment method detached, no charge.
6. After the ride: staff complete legs and enter wait time → charges summed → off-session PaymentIntent on the saved card.
7. No-show / late cancel → fee charged the same way.
8. Failed charge → payment `FAILED`, booking shown as payment due; customer emailed a link to pay with another card.
9. Refunds: admin only, recorded as a charge line.
10. Webhooks: signature verified, processed once per Stripe event id (`StripeEvent`). Only the booking id goes in Stripe metadata.

## Status rules

| From | To | Who | Condition |
|---|---|---|---|
| `PENDING_PAYMENT` | `REQUESTED` | System | Card saved (webhook) |
| `REQUESTED` | `CONFIRMED` | Staff | |
| `REQUESTED` | `CANCELLED` | Staff / customer | No charge |
| `CONFIRMED` | `CANCELLED` | Staff / customer | Late-cancel fee if < 2h before pickup |
| `CONFIRMED` | `NO_SHOW` | Staff | ≥ 15 min after pickup time; return leg auto-cancelled |
| `CONFIRMED` | `COMPLETED` | Staff | All legs completed/cancelled; triggers charge |
| Any final status | Corrected | Admin only | Note required; refunds/adjustments recorded |

Every transition writes a `BookingEvent` and an `AuditLog` entry.

## Customer accounts

Customers must create an account to book (decided 2026-10-09). Guest booking may be added later; `Booking.customerId` is optional for that reason.

- Sign-up: first name, last name, email, phone, password (8+ chars, argon2id), terms acceptance (`TERMS_VERSION`). Email must be verified (24h link) before booking.
- Responses never reveal whether an email has an account (sign-up, resend, forgot password).
- Login: email + password; 5 failures → 15-minute lock. MFA optional for customers (not built yet).
- Sessions: server-side, httpOnly `lade_sid` cookie; end after 7 days idle or 30 days.
- Password reset: 1-hour one-time link; signs out every session.
- Email, first name, last name and phone are encrypted (being a Lade customer is PHI); lookup via `emailHash`.
- Endpoints: `POST /auth/signup`, `/auth/verify-email`, `/auth/verify-email/resend`, `/auth/login`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`; `GET /auth/me`.
- My rides: `GET /bookings` and `GET /bookings/:id` return each ride with leg progress, final charges (no staff notes), payment status and `cancel: { allowed, feeCents }`. Website: `/my-rides` (upcoming / past) and `/my-rides/<id>`.
- Customer cancellation: `POST /bookings/:id/cancel` `{ reason?, acceptedFeeCents? }`. Allowed for REQUESTED or CONFIRMED rides until the pickup time (after that: call). Free for requests and until `LATE_CANCEL_WINDOW_MINUTES` before a confirmed pickup; then the late-cancellation fee, charged only if `acceptedFeeCents` covers it (otherwise 409 with the fee, so nobody pays a fee they didn't see). Emails the customer and all active staff. Shared with staff cancellation: `src/bookings/booking-status.ts`.
- The "manage your ride" link for guests (`Booking.manageToken*`) waits until guest booking is built.

## Staff auth

- Accounts are only created by accepting an invite (48h, one-time link). The first ones come from the bootstrap command: `npm run staff:invite -- --email <email> --role ADMIN`. Later, admins invite from `/admin`.
- Accepting: scan the authenticator QR code and confirm a 6-digit code first (checked right away), then set name + password. Nobody else ever knows the password or MFA secret.
- Login: email + password + TOTP code (required). Used codes can't be replayed. 5 failures → 15-minute lock.
- Sessions: server-side, httpOnly `lade_staff_sid` cookie (separate from customers); end after 15 minutes idle (HIPAA automatic logoff), 12 hours, or when the account is deactivated.
- Roles: **DISPATCHER** — view, confirm, cancel, record wait time, mark no-show. **ADMIN** — everything plus staff management, pricing, fee waivers/adjustments, refunds, status corrections. Initial admins: Jevon and the two owners.
- Endpoints: `POST /staff/invites/accept/start`, `/staff/invites/accept/verify-code`, `/staff/invites/accept/complete`, `/staff/auth/login`, `/staff/auth/logout`; `GET /staff/auth/me`.
- Viewing bookings (dispatchers and admins): `GET /staff/bookings` lists by outbound pickup time (`sort=pickup`, default) or `sort=newest`, filtered by `status` (default: all but `PENDING_PAYMENT`), pickup days `from`/`to` (YYYY-MM-DD in `BUSINESS_TIMEZONE`, inclusive; with no dates and no search, today onward), exact `reference` or exact `riderLastName` (blind index), paged (`page`, `pageSize` ≤ 100). Rows are summaries; `GET /staff/bookings/:id` adds requester, payment, leg progress and status history. Both are `no-store` and every view is audited (`staff.bookings_listed` with the booking ids, `staff.booking_viewed`), without PHI.
- Actions (`POST /staff/bookings/:id/…`, each returns the updated booking with `actions`: what's allowed right now, from `staff-bookings/booking-actions.ts`):
  - `confirm`: REQUESTED → CONFIRMED.
  - `cancel` `{ reason, waiveFee?, waiveReason? }`: REQUESTED or CONFIRMED → CANCELLED, legs cancelled. Confirmed rides inside `LATE_CANCEL_WINDOW_MINUTES` get a `LATE_CANCELLATION` charge; admins can waive it (an `ADJUSTMENT` line for the same negative amount, with the reason).
  - `no-show`: CONFIRMED → NO_SHOW, only from pickup + grace period; `NO_SHOW` fee on the outbound leg, ride back cancelled free.
  - `complete` `{ outboundWaitMinutes?, returnLeg?: COMPLETED|CANCELLED, returnWaitMinutes? }`: CONFIRMED → COMPLETED, only from the pickup time. Charges base fare + mileage for the legs that happened (`completedRideCharges`: a round trip without its ride back is billed one-way) + waiting time per leg.
  - `retry-charge`: for a final booking whose payment is `FAILED` or `CHARGE_PENDING`.
  - Status changes are conditional updates (two staff at once → 409), with a `BookingEvent` (reason in its encrypted note) and an audit entry without PHI.
- Charging (`payments/booking-payments.service.ts`): after each action, the saved card is charged off-session for the sum of the booking's `BookingCharge` lines. The payment is claimed as `CHARGE_PENDING` first; the Stripe idempotency key is `charge-<paymentId>-<attempt>` (new attempt only after a decline), so a retry after a lost answer can't charge twice. Declines → `FAILED` with Stripe's code; nothing owed → `CANCELED` and the card is detached. Not yet: emailing the customer a pay link after a decline, refunds and admin adjustments after charging, `payment_intent.*` webhooks.
- Admin screens live at `/admin` in the Next.js site, never cached, `noindex`.

## Request security

- Every state-changing request must carry `Origin: SITE_URL` (CSRF protection), except endpoints marked `@SkipOriginCheck()` such as future Stripe webhooks.
- Rate limits per IP: 300/min overall, `AUTH_RATE_LIMIT_PER_MINUTE` (10) per auth endpoint. In memory per instance.
- Every login, failed login, sign-up, verification, reset and invite is in the audit log, with no PHI.

## Notifications (phases 1–3)

Email goes through the `Mailer` token: `LogMailer` (`MAIL_TRANSPORT=log`, prints to the log; development and tests) or `SesMailer` (`MAIL_TRANSPORT=ses`, Amazon SES v2 in `AWS_REGION`, us-east-2 / Ohio, where `ladehcs.com` is verified). Sender `MAIL_FROM` (default `Lade Health Care Services <no-reply@ladehcs.com>`), optional `MAIL_REPLY_TO`. Credentials: `SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY` of an IAM user allowed only `ses:SendEmail` (local and non-AWS hosting); empty on AWS hosting with a role. Recipient addresses never go in logs.

Booking emails (`src/notifications/booking-notifications.service.ts`, texts in `src/mail/booking-templates.ts`) carry only the booking reference, amounts and links: no names, addresses, times or medical details. A failed email is logged with the booking id and never blocks the booking change.

- Card saved (once, website or webhook): customer "request received"; every active staff member "New ride request LD-…" with a link to the booking.
- Staff confirm / cancel / no-show / complete: customer email; fees say whether the card was charged. Completed + charged → receipt. A declined charge → "we couldn't charge your card" with a link to /contact. Retry that succeeds → receipt.

Before launch: SES production access (out of the sandbox), a real reply-to inbox (ladehcs.com has no MX records), SES bounce/complaint handling (configuration set + notifications).

## Schema

The source of truth is [`prisma/schema.prisma`](../prisma/schema.prisma). Summary:

- **Booking** — one request, with requester, rider, quote snapshot, terms consent and manage-link token.
- **TripLeg** — outbound and optional return leg; times, encrypted addresses, distance, actual wait.
- **BookingCharge** — line items (base fare, mileage, wait time, no-show, late cancel, adjustment).
- **BookingEvent** — status history.
- **Payment** / **StripeEvent** — Stripe IDs and amounts; processed webhook events.
- **PricingRule** — rates per channel and care level, versioned by effective dates.
- **StaffUser** / **RefreshToken** / **StaffInvite** — staff auth.
- **AuditLog** — append-only HIPAA audit trail.

## Open items

**Lade:**

- ~~Accept the AWS BAA~~ — done 2026-10-20. The account (created with Google sign-up) needed the paid plan **and** "Activate advanced features" before Artifact worked. Keep the downloaded BAA PDF in Lade's records.
- **Launch blocker:** accept the **Google Workspace BAA**. Lade's email (info@ladehcs.com) runs on Google Workspace, and it's the reply-to address of every email the site sends, so customer replies (which can include rider or medical details) land there. Free, paid Workspace plans only: admin.google.com → Account → Account settings → Legal and compliance → accept the HIPAA Business Associate Amendment.
- **Launch blocker:** add two DNS records at Network Solutions (where ladehcs.com's DNS is), so Lade's emails don't go to spam. As of 2026-10-23 the domain has neither:
  - SPF, a TXT record on `ladehcs.com`: `v=spf1 include:_spf.google.com include:amazonses.com ~all` (Google Workspace and Amazon SES may send as ladehcs.com). Only one SPF record per domain: merge with any existing one.
  - DMARC, a TXT record on `_dmarc.ladehcs.com`: `v=DMARC1; p=none; rua=mailto:info@ladehcs.com` (monitor-only, reports to info@; tighten later).
  - Check afterwards: `dig +short TXT ladehcs.com` and `dig +short TXT _dmarc.ladehcs.com`.

- Sign off on the stretcher rate and no-show / late-cancel fees; update the rate card (add stretcher and no-show / late-cancel fees).
- Terms of service + privacy notice covering wait time, no-show and late-cancel rules (checkout consent depends on it).
- Records retention period (HIPAA documentation is 6 years; check Florida requirements).
- Whether to collect Medicaid / insurance IDs.
- BAA between Lade and Jevon. Lade should own the Google Cloud, AWS and Stripe accounts.

**Website (`lade-healthcare-services`):**

- Replace placeholders in `src/lib/site.ts` with real details from the rate card (5100 N Nebraska Ave, Tampa, FL 33603; (708) 735-5701; info@ladehcs.com).
- Add Bariatric wheelchair as a care level.
- `/book-a-ride` page (phase 2) and `/admin` section (phase 3).

**Engineering:**

- Re-encryption job for key rotation (re-encrypt rows still on an old key id).

**Engineering before phase 1:**

- Confirm current Cloud Run / Cloud SQL / AWS Location Service prices in the pricing calculators.
- Repo conventions: `CLAUDE.md`, lint/format, tests (pricing math first), GitHub Actions CI.
