# lade-hcs-server

Booking API for Lade Health Care Services (non-emergency medical transport, Tampa). The website is the separate Next.js repo `lade-healthcare-services`. Decisions, pricing rules, flows and open items are in `docs/plan.md`; read it before changing booking, pricing or payment behavior.

## Rules

- **Never run `git commit`** (or push, or offer to commit). The user commits everything themselves. Leave changes in the working tree.
- **This app handles PHI** (rider identity, addresses, medical trips, mobility notes). HIPAA applies:
  - Access the database only through the injected `PrismaService`. Never `new PrismaClient()` and never raw SQL (`$queryRaw` / `$executeRaw`) on encrypted columns: both bypass encryption.
  - New PHI field → mark it `/// @encrypted` in `prisma/schema.prisma` (as `String`) and add it to `src/prisma/encrypted-fields.ts`. A test fails if they drift.
  - Never put PHI in logs, error messages, emails, Stripe metadata or API error responses.
  - Search encrypted fields via their `*Hash` column and `BlindIndex.hash()`; filtering or sorting on an encrypted field throws.
  - Tests and local dev use fake data only.
- Auth: customers and staff have separate sessions, cookies and guards (`CustomerAuthGuard` / `StaffAuthGuard`). Auth endpoints get `@AuthRateLimit()`. Responses must never reveal whether an email has an account. State-changing requests need the site's `Origin` (OriginGuard).
- Read settings through `ConfigService<Env, true>`, never `process.env`. New setting → add it to `src/config/env.validation.ts` and `.env.example`. Secret settings go in `SECRET_SETTINGS` so their values are never echoed.

## Conventions

- NestJS 12, ES modules: relative imports end in `.js` (`./foo.service.js`).
- Non-class functions use arrow syntax (`const bootstrap = async () => {}`), matching the website repo. Nest classes, decorators and class methods stay as they are.
- Comments explain *why*, briefly. Prettier: single quotes, trailing commas.
- Money is integer cents. Times are stored UTC (`Timestamptz`) and shown in `BUSINESS_TIMEZONE`.
- Tests: `*.spec.ts` beside the code (unit, Vitest). `test/*.e2e-spec.ts` boot the app against the separate `lade_hcs_test` database (from `.env.test`), never the dev database.

## Commands

```bash
npm run start:dev        # API on :4000, restarts on change
npm test                 # unit tests
npm run test:e2e         # e2e tests (run test:db:prepare first after new migrations)
npm run test:db:prepare  # apply migrations to the test database
npm run typecheck && npm run lint && npm run format:check
npm run db:migrate       # create/apply a migration on the dev database
npm run db:generate      # regenerate the Prisma client (src/generated, not committed)
npm run db:seed          # starting pricing rules (safe to re-run)
npm run keys:generate    # fresh local encryption keys for .env / .env.test
npm run staff:invite -- --email <email> --role ADMIN   # bootstrap a staff invite link
```

After changing `prisma/schema.prisma`: `npm run db:migrate`, `npm run db:generate`, `npm run test:db:prepare`.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, format check, unit and e2e tests (against a throwaway Postgres) and the build on every push to `main` and every PR.
