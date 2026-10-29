# Deploying Lade to Google Cloud

Everything runs in one Google Cloud project (Lade's), region **us-east1**,
covered by the Google Cloud BAA:

| Piece | What | Name |
|---|---|---|
| Website | Cloud Run service, deployed from GitHub `lade-healthcare-services` (`main`) | `lade-website` |
| API | Cloud Run service, deployed from GitHub `lade-hcs-server` (`main`) by `cloudbuild.yaml` | `lade-api` |
| Database updates | Cloud Run job, run by every API deploy before the new version goes live | `lade-db-migrate` |
| Database | Cloud SQL for PostgreSQL 16 | instance `lade-db`, database `lade`, user `lade_api` |
| Secrets | Secret Manager | named like the settings: `DATABASE_URL`, … (below) |

How the pieces talk:

- Browsers only talk to the website. It forwards `/api/*` to the API
  (`API_URL`), adding a shared secret (`API_PROXY_SECRET` = the API's
  `PROXY_SECRET`); the API refuses anything without it, except `GET /health`.
- The API reaches the database through Cloud Run's built-in Cloud SQL
  connection (a private socket), not over the internet.
- AWS (us-east-2) still does address lookup, mileage and email (SES).

Releasing: work on `dev`; merging `dev` into `main` and pushing deploys.

---

## 1. Turn on the services (once)

Console → **APIs & Services → Library**, enable:

- Cloud Run Admin API, Cloud Build API, Artifact Registry API (done for the website)
- **Cloud SQL Admin API**
- **Secret Manager API**

## 2. Database: Cloud SQL (once, about 15 minutes)

Console → **SQL → Create instance → PostgreSQL**:

- **Edition:** Enterprise. **Preset:** Sandbox (or Development)
- **Instance ID:** `lade-db`
- **Password** for the `postgres` user: generate one and save it in a password manager
- **Version:** PostgreSQL 16
- **Region:** us-east1, single zone
- **Machine:** the smallest shared-core option (e.g. 1 vCPU shared, ~0.6 GB)
- **Storage:** SSD, 10 GB, automatic increases on
- **Connections:** leave **Public IP** on with **no authorized networks**
  (Cloud Run connects through Google's Cloud SQL connector, which checks
  Google permissions; nothing else can reach it)
- **Data protection:** automated **daily backups** on, **point-in-time
  recovery** on, deletion protection on
- **Create** (takes ~10 minutes)

Then, on the instance:

- **Databases → Create database:** `lade`
- **Users → Add user account:** `lade_api`, built-in authentication, a strong
  password **with only letters and numbers** (it goes inside a URL). Save it.

## 3. The API's identity (once)

Console → **IAM & Admin → Service Accounts → Create service account**:

- **Name:** `lade-api` (Google may add a suffix to the ID; Lade's is
  `lade-api-637`, set as `_RUNTIME_SA` in `cloudbuild.yaml`)
- **Roles:** **Cloud SQL Client**, **Secret Manager Secret Accessor**

(The website gets read access to just one secret, `PROXY_SECRET`, in step 4.)

## 4. Secrets (once; change them here, never in code)

Console → **Security → Secret Manager → Create secret**, one per row. Paste
values straight from where they're generated; never put them in chat,
email or GitHub.

| Secret name | Value |
|---|---|
| `DATABASE_URL` | `postgresql://lade_api:PASSWORD@localhost/lade?host=/cloudsql/PROJECT_ID:us-east1:lade-db` (PASSWORD and PROJECT_ID filled in) |
| `ENCRYPTION_KEYS` | the `ENCRYPTION_KEYS=` value printed by `npm run keys:generate` (see below) |
| `BLIND_INDEX_KEY` | the `BLIND_INDEX_KEY=` value from the same output |
| `PROXY_SECRET` | a new random value: `openssl rand -hex 32` |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_…` while testing) |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (`pk_test_…` while testing) |
| `SES_ACCESS_KEY_ID` | the SES IAM user's access key ID |
| `SES_SECRET_ACCESS_KEY` | the SES IAM user's secret access key |
| `AWS_LOCATION_API_KEY` | the AWS Location API key |

**Let the website read `PROXY_SECRET` (only that one):** copy the website's
service account from Cloud Run → `lade-website` → **Security** (usually
`…-compute@developer.gserviceaccount.com`), then Secret Manager →
`PROXY_SECRET` → **Permissions → Grant access** → that account, role
**Secret Manager Secret Accessor**.

**Production encryption keys:** in `lade-hcs-server`, run
`npm run keys:generate`. It prints brand-new keys (it doesn't change any file).
Use them only for production, never locally.
**Before going live, Lade must keep a copy outside Google** (e.g. the
owner's password manager): if these keys are lost, every encrypted name,
address and note in the database is unreadable, permanently.

## 5. Let Cloud Build deploy (once)

Cloud Build runs `cloudbuild.yaml` as a service account (shown when creating
the trigger; usually the **Compute Engine default service account**). In
**IAM**, give that account:

- **Cloud Run Admin**
- **Service Account User**
- **Artifact Registry Writer**
- **Logs Writer**

## 6. The API trigger (once)

Console → **Cloud Build → Triggers → Create trigger**:

- **Name:** `lade-api-deploy`, **Region:** us-east1 (or global)
- **Event:** push to a branch; **Repository:** `jevoncochran/lade-hcs-server`
  (connect it like the website); **Branch:** `^main$`
- **Configuration:** Cloud Build configuration file, location `cloudbuild.yaml`
- **Substitution variables:** `_SITE_URL` = the website's address
  (`https://lade-website-….run.app` for now; `https://ladehcs.com` later)
- **Service account:** the one from step 5
- **Create**, then **Run** it (or push to `main`)

The run shows three phases in Cloud Build → History: build, `migrate`
(database updated and starting prices loaded), `deploy`. The API's address is
then on Cloud Run → `lade-api`.

## 7. Connect the website to the API (once)

Cloud Run → `lade-website` → **Edit & deploy new revision → Variables &
secrets**:

- Variable `API_URL` = the `lade-api` address (`https://lade-api-….run.app`)
- **Reference a secret:** `PROXY_SECRET` as environment variable
  `API_PROXY_SECRET` (version: latest). Same value as the API's
  `PROXY_SECRET`: one secret, read by both.
- **Deploy**

These stay set across future website deploys.

## 8. Check it works

- `https://<website>/api/health` → `{"status":"ok","database":"up"}`
- `https://<api>/auth/me` (directly, skipping the website) → `403 Forbidden`
- Sign up with a real email, verify, book with a Stripe test card
  (4242 4242 4242 4242), check My rides, the contact form, and the emails.
- **Visitor addresses:** after a sign-in, check the latest audit-log entry's
  IP is yours (not Google's). If not, adjust `TRUST_PROXY_HOPS` (default 2).

## 9. First admin accounts

Admins are created with an invite link. In production that runs as a Cloud
Run job against the live database (instructions to follow when we get there).

## Later: going live (owner session)

1. Point `ladehcs.com` (+ `www`) at `lade-website` (Cloud Run → Manage custom
   domains), add the DNS records at Network Solutions; add SPF and DMARC.
2. Change the trigger's `_SITE_URL` to `https://ladehcs.com`.
3. Stripe live keys into `STRIPE_SECRET_KEY` / `-publishable-key`, a
   live webhook to `https://ladehcs.com/api/payments/stripe/webhook`, its
   signing secret in `STRIPE_WEBHOOK_SECRET` (and added to
   `cloudbuild.yaml`), `_ALLOW_TEST_PAYMENTS` = `false`. Redeploy.
4. Back up the production encryption keys outside Google (owner).
