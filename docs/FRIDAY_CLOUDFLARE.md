# Kept FRIDAY Cloudflare setup — staged infrastructure

**Owner:** Kept. **Purpose:** optional, permission-scoped reminders for Vela.
**Data status:** No household summaries are published or readable by Vela.

## Empty D1 database

The [provisioning workflow](../.github/workflows/provision-friday-d1.yml)
checks for an exact-name `kept-friday-reminders` D1 database and creates one
if absent. It runs when that workflow is first merged to `main`, and can be
manually rerun. Creation is idempotent; the script sends **only** a database
name and disables read replicas. It does **not** add a Worker binding, deploy
an API, create tables, upload reminders or change Kept's encrypted sync.

Use the Kept repository's private GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `KEPT_FRIDAY_D1_TOKEN` (preferred): a dedicated account-scoped token with
  **D1 Read and D1 Write** only. If not configured, the workflow tries the
  already configured `CLOUDFLARE_API_TOKEN`; it must independently have
  D1 permissions to succeed. **Do not broaden** an existing app deployment
  token just to bypass a 403. Do not paste any token into issues.

If provisioning fails with HTTP 403, **stop**. Update a narrowly scoped token
through GitHub Actions secrets or configure the database through the account
dashboard with owner authorization. Do not bypass a permission failure. Use
Cloudflare's [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
and free-plan counters; no paid upgrade is part of this workflow.

## Cloudflare Access admin login — not enabled yet

Plan to use Cloudflare Access **One-time PIN** for only named, approved
household administrators. The owner must provide the exact authorized email
addresses privately through Cloudflare; never store them in this public
repository, workflow inputs or build logs.

**Do not protect the existing `kept-sync` Worker as a whole.** That would
break its cross-origin encrypted sync clients. A future, isolated Kept sharing
Worker will have Access protection for its administrative route(s), and
separate per-TV-device, per-profile, revocable credentials for read-only
reminders. Merely possessing a Vela remote PIN or Kept sync token must never
grant cross-app read access.

Before enabling Access or a sharing Worker:

1. Enable/verify Cloudflare Zero Trust and choose approved admin addresses.
2. Register the isolated Worker host/admin routes only; fail closed to all
   other users and validate `ctx.access` on every admin request.
3. Define short-lived device pairing, key rotation, grant expiry and server
   revocation; no bearer tokens in URLs.
4. Bind D1 only to the reviewed sharing Worker, run migrations, enforce TTL
   and prohibit broad listing of household/private state.
5. Test unauthorized access, expired grants, offline protected display,
   profile switch, caching, rate limits and rollback on actual devices.

Current `projectFridayReminders` in Kept remains a **local-only helper**
until this acceptance list and the FRIDAY [ADR 0001](https://github.com/vudh1/friday/blob/main/docs/DECISIONS/0001-kept-reminder-consent.md)
are satisfied.
