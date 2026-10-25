# Kept FRIDAY cardless GitHub administrator authentication — staged

**Status: GitHub sign-in approach approved by owner; implementation remains a draft under review, not deployed or enabled.** This is a separate Worker entrypoint. It does **not** replace `kept-sync` or the existing fail-closed `kept-friday-admin` Worker, nor does it expose a reminder read, write or TV pairing route. It is intentionally absent from any deployment workflow or production `wrangler.toml`.

**Owner-reported setup status (2026-10-25):** the owner says the dedicated GitHub OAuth App is registered, its client secret generated, the Workers plan is Free and the account subdomain is `vudhone.workers.dev`. These are owner attestations, **not** independent access to GitHub OAuth App settings, Cloudflare billing, or invoices. The planned callback remains `https://kept-friday-auth.vudhone.workers.dev/auth/callback` and that Worker is **not live**.

## Why GitHub OAuth

The owner already uses GitHub. GitHub's web application OAuth flow supports authorization-code + **PKCE S256** with exact callback validation, no need for a new Cloudflare Zero Trust billing profile, and one narrow `read:user` scope. GitHub's immutable numeric user ID is checked against an exact private allowlist. A short-lived, revocable **D1-backed** session is then created; the OAuth access token is discarded and never stored. This is administrator authentication only, **not** consent to share data to a particular TV profile.

Alternatives: passkeys/WebAuthn can remove the GitHub login dependency but need a safe first-enrollment/recovery policy and audited verifier. Do not weaken this candidate to a static PIN, encrypted-state passphrase or remote-control PIN.

## Flow and safety

1. `GET /auth/start`: rate limit by keyed hash of the edge IP, generate 256-bit OAuth state and PKCE verifier, store the verifier in D1 for 5 minutes, send an HttpOnly/Secure/SameSite=Lax state cookie, redirect to GitHub.
2. `GET /auth/callback`: require exact browser state cookie, atomically consume the stored state, exchange one-time code server-side with PKCE and the private client secret, fetch authenticated GitHub `/user`, require the exact allowed numeric ID, issue a random 20-minute D1 session cookie. Refuse unexpected OAuth scopes. Clear state cookie. Never store GitHub tokens.
3. `GET /auth/status` and `GET /health`: require live DB-backed allowed session, return only `{ok, service, sharingEnabled:false}`. No household data.
4. `POST /auth/logout`: same-origin only, delete current session. `POST /auth/revoke-sessions`: same-origin, remove all sessions for that authenticated GitHub ID. A removed allowlist ID is rejected on the next request. Expired sessions fail immediately. Clear cookies. No CORS, no browser localStorage credentials.
5. Any DB outage, malformed configuration, invalid callback, token or GitHub request fails closed with no sensitive message. Daily/free D1 limits can make sign-in unavailable; **never** bypass auth when limits are reached. One isolated auth Worker is optional; Kept and Vela retain independent offline operations.

## Remaining gates before deployment

- [ ] Review and threat-test login CSRF, D1 atomic `RETURNING` behavior in an actual local Wrangler D1 instance, rate-limit bypass/DoS, cookie/session expiration, spoofed requests, browser logout, and cross-site redirects. Unit mocks and Node's actual SQLite engine smoke are **not** a complete Cloudflare D1 integration test. Run `node tests/friday-github-auth-sqlite.smoke.mjs` on Node 24+ from the Kept repo root for a real-SQLite-only check.
- [ ] Owner registers a separate **GitHub OAuth App**, with exact `https://<dedicated-worker-host>/auth/callback` redirect and **wildcard callback matching disabled**. Do not request repository access or additional scopes. Requires an owner-managed GitHub account; do not put registration credentials into source. The planned dedicated host is `https://kept-friday-auth.vudhone.workers.dev`, *not yet deployed*; confirm that host is actually available in the owner's Cloudflare account before registering its callback.
- [ ] Owner provisions private Worker secrets: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ADMIN_GITHUB_IDS` (JSON numeric immutable IDs), `RATE_LIMIT_KEY` (32+ unpredictable characters), `PUBLIC_BASE_URL` (exact HTTPS origin). Never log these or populate the repo with personal identifiers.
- [ ] Review the **existing** Cloudflare Workers account's *actual* plan/usage for cardless safety; do not use a card-required tier. Get separately approved D1 binding `AUTH_DB` to the existing **empty** `kept-friday-reminders` database only after the migration is reviewed and applied intentionally. No migration, D1 schema or new Worker is deployed by this PR.
- [ ] Check provider terms immediately before activation; perform local Wrangler D1 and end-to-end GitHub login smoke tests; confirm callback origin and all negative tests in an isolated preview. Manually test revoke-all, expiry, HTTP 403/503 and outages.
- [ ] Add a reviewed household consent and per-TV device/profile read grant protocol. This sign-in does not authorize viewing even one task on a television. Vela must default-hide protected Life content and revoke cached projections.

### Local-only Wrangler D1 verification

The file [`wrangler.local.toml`](wrangler.local.toml) binds a **fictitious UUID** for a temporary database, disables `workers.dev` deployment, and has no real credentials. It is for **local testing only**. Never pass `--remote`, deploy that configuration, or put the GitHub OAuth secret in source code.

```sh
# From the repository root; does not require Cloudflare login.
npx wrangler d1 execute kept-friday-auth-local-only --local \
  --config worker/friday-auth/wrangler.local.toml \
  --file worker/friday-auth/schema.sql
```

Using local Wrangler **4.46.0** on 2026-10-25, all seven schema statements succeeded. A one-time `DELETE ... RETURNING verifier` returned the verifier on the first call and zero rows on replay. A separate local `INSERT ... ON CONFLICT ... RETURNING attempts` correctly produced rate-limit counts 1 and 2 in successive calls. **Caveat:** three `RETURNING` statements bundled into one `wrangler d1 execute --command` hit a local `SQLITE_BUSY` error; each statement succeeded when invoked separately. This is CLI/local SQL evidence, **not** a deployed Worker or an end-to-end login test. Actual Worker D1 `.first()` integration, GitHub redirect/cookies, revocation and quota-failure handling remain gates.

**Credential handoff:** store the generated `GITHUB_CLIENT_SECRET` only in your private password manager until a separately approved isolated preview is ready. `wrangler secret put` can deploy a Worker immediately; do **not** run it as a harmless preparatory step. GitHub Actions secrets do not automatically become Cloudflare Worker runtime secrets.

## Cost boundary

This staged code makes **no external service calls until manually deployed and configured**; there is no new payment method, upgrade or deployment workflow. GitHub OAuth registration and GitHub public `/user` API are used as an identity path, not a billed GitHub Action. Cloudflare documents [D1 Free usage hard limits](https://developers.cloudflare.com/d1/platform/pricing/) and [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/); code and CI cannot certify existing account invoices or payment methods. Monitor provider usage after owner-authorized preview activation. No current live billing status was checked.

## Rollback

Do not activate/route traffic to this Worker; the current Access-only administrator Worker remains fail-closed. After a separately authorized preview, disable its Worker route or unset its identity configuration and revoke sessions in D1. Never touch `kept-sync`, encrypted `runtime-state`, or Vela's existing ICS feeds.
