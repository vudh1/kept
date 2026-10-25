# Kept FRIDAY Cloudflare setup — staged infrastructure

**Owner:** Kept. **Purpose:** optional, permission-scoped reminders for Vela.
**Data status:** No household summaries are published or readable by Vela.

## Cardless decision — October 25, 2026

The owner selected FRIDAY's [no-payment-information policy](https://github.com/vudh1/friday/blob/main/docs/COST_POLICY.md). Cloudflare Zero Trust Free requires a billing profile, so **do not finish that enrollment** for FRIDAY. The old Access application creation failed HTTP 403 on discovery; no Access application has been verified.

The separate `kept-friday-admin` Worker was previously deployed with an exact-email secret, but it requires `ctx.access`, has no data API or D1 binding, and **fails closed without Access**. Its automatic deployment workflow is now retired, and manual invocation will stop before any Cloudflare mutation. The existing `kept-sync` Worker remains unchanged. A no-card, reviewed identity replacement is tracked in [FRIDAY issue #13](https://github.com/vudh1/friday/issues/13). Do not use the old Access token as an authentication workaround.

**Billing visibility:** neither GitHub source nor tests can prove actual provider charges or existing payment-method status. No new FRIDAY billing enrollment is authorized.

## Empty D1 database — provisioned, not connected

The [provisioning workflow](../.github/workflows/provision-friday-d1.yml)
checks for an exact-name `kept-friday-reminders` D1 database and creates one
if absent. GitHub Actions run [#40190828799](https://github.com/vudh1/kept/actions/runs/40190828799), attempt 2, confirmed creation on October 25, 2026. It is **empty**:
no Worker binding, tables, API, reminder upload or change to encrypted sync.

Required private GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`: account ID.
- `KEPT_FRIDAY_D1_TOKEN`: dedicated account-scoped token with **D1 Read and
  D1 Write**. The provisioning workflow falls back to the existing
  `CLOUDFLARE_API_TOKEN` if this secret is absent; do not broaden permissions
  just to bypass a 403.

If provisioning fails with HTTP 401/403, **stop** and obtain the narrowly
scoped token from the owner. Do not put credentials in issues. See
[Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
and free-plan counters; no paid upgrade is part of this plan.

## Isolated Access administrator Worker — independent from sync

The historical [Access workflow](../.github/workflows/deploy-friday-access.yml)
previously validated Kept and deployed the dedicated `kept-friday-admin`
Worker. Access policy creation **never succeeded**. That workflow is now
retired under the cardless policy and cannot deploy or configure Cloudflare.
The intended policy (not deployed) restricted one immutable Worker ID to
named approved emails and a one-hour session; no broad email-domain,
everyone, service-token bypass or all-Workers policy was authorized.

The administrator Worker currently exposes **only** `GET /health`, returning
`sharingEnabled: false` after valid Cloudflare Access identity. It checks
`ctx.access.getIdentity()` against the same named-email allowlist and returns
403 otherwise. It has **no D1 binding** and no household-data APIs. Deploying
it does **not** enable Kept-to-Vela sharing.

**Historical, inactive setup:** these were used for the attempted Access stage.
Do not create new billing credentials or retry Access under the cardless policy.
Secrets belong only in private GitHub Actions storage, never in source or logs:

- `KEPT_FRIDAY_ADMIN_EMAILS`: JSON array of 1–10 specific approved email
  addresses, e.g. `["owner@example.com"]` (illustrative, not a real user).
- `CLOUDFLARE_ACCOUNT_ID`: existing account ID.
- `CLOUDFLARE_API_TOKEN`: existing Kept Worker deploy token; used **only**
  to deploy the isolated Worker and inject its private secret.
- `KEPT_FRIDAY_ACCESS_TOKEN` (required): dedicated account-scoped token with
  **Access: Apps and Policies Edit** and **Workers Scripts Read**. The workflow
  uses this token for both read-only Worker-ID discovery and Access app
  creation. It **does not fall back** to the unrelated Worker deploy token.
  If either discovery or creation returns 401/403, stop and review the
  permission with the owner; never broaden an unrelated token.

Prerequisite: Cloudflare Zero Trust is enabled, and an appropriate sign-in
method (such as One-time PIN) has been configured for the allowed emails.
Creating a policy does not configure an identity provider or grant access
to any unspecified emails.

The workflow deliberately stops if an Access application of the same name
already exists: a human must verify its effective destination and policy
before any future changes. Do not silently replace a potentially weaker
policy. Verify the live Access application after the first deployment.

**Do not protect the existing `kept-sync` Worker.** That would break its
cross-origin, ciphertext-only client sync. Do not use its shared sync token,
browser encryption passphrase, Vela remote PIN or a public calendar link as
a cross-app identity.

## Not yet implemented: Vela device-specific reader access

Before any data is shared:

1. Design a minimal explicit-consent projection of selected reminders that
   does not require publishing decrypted Kept state by default.
2. Implement a **separate read-only Vela device/profile grant**, short-lived
   pairing, key rotation, expiry and server-side revocation. Administrator
   Cloudflare Access email login is **not** a TV/device credential.
3. Scope reads to explicitly selected reminders only; encrypt data in transit
   and at rest, prohibit broad listing and keep bearer tokens out of URLs.
4. Bind D1 to the future reviewed sharing service, apply migrations/TTLs,
   and add rate limits and audit behavior without storing private content in
   logs, GitHub or FRIDAY issues.
5. Test unauthenticated access, revoked/expired grants, profile switch,
   hidden display by default, offline failure, timezone/DST, caching and
   rollback on the actual Vela TV.

`projectFridayReminders` in Kept is still a **local-only helper** until the
FRIDAY [ADR 0001](https://github.com/vudh1/friday/blob/main/docs/DECISIONS/0001-kept-reminder-consent.md)
and these acceptance conditions are satisfied.
