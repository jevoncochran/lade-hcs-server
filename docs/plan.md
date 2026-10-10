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
- **Email:** PHI-free messages only (see Notifications), so any provider works; start on a free tier (e.g. Resend).
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

- Round trip mileage = total billable passenger miles for both legs.
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

1. `POST /quotes` → price breakdown, or "call for a quote" (long distance, out of state, no pricing rule).
2. `POST /bookings` (idempotency key, honeypot, rate limited) → server recalculates price, records terms version + acceptance, creates booking `PENDING_PAYMENT`, a Stripe Customer (email only) and a SetupIntent (`usage: off_session`). Returns the client secret.
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

## Customer booking management (no accounts)

- Confirmation email contains a "Manage your ride" link with a random token (stored hashed), expiring 7 days after the last leg.
- Page shows reference, status, times, care level, price, partially masked addresses.
- Customer can cancel online (late-cancel fee shown before confirming). Rescheduling is by phone in v1.
- Lost link: enter reference + email → link re-sent to the email on file. Rate limited; response never reveals whether a booking exists.

## Staff auth

- Email + password (min 12 chars, argon2id) + required TOTP MFA.
- 15-minute access tokens with sliding refresh; 15-minute idle logout. Tokens in httpOnly cookies.
- 5 failed logins → 15-minute lockout. All attempts audited.
- First admin created by a CLI seed script. Further staff invited by an admin via a one-time 48-hour link (set password + MFA).
- Roles: **DISPATCHER** — view, confirm, cancel, record wait time, mark no-show. **ADMIN** — everything plus staff management, pricing, fee waivers/adjustments, refunds, status corrections.
- Admin screens live at `/admin` in the Next.js site, never cached, `noindex`.

## Notifications (phases 1–3)

PHI-free only:

- Staff alert: "New booking LD-7K3Q9 — log in to view."
- Customer: confirmation / cancellation with the manage link; payment-failed with a pay link. No names, addresses, medical details.

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
