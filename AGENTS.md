# Kept agent instructions

Read [README.md](README.md), [FRIDAY.md](FRIDAY.md), relevant code/tests and GitHub Actions workflows before changes. Validate source and runtime state separately; code presence does not prove live Worker/sync configuration.

## Product and security invariants

- Kept is a local-first household maintenance and shopping PWA; it works without Cloudflare, AI, GitHub sync or FRIDAY.
- Optional sync stores a **client-encrypted** AES-GCM envelope on `runtime-state`. The Worker transports ciphertext; a short PIN or shared sync token is not a household identity or a substitute for the encryption passphrase.
- No public plaintext household data, decrypted snapshots, secrets, calendar URLs or personally identifying test fixtures. Do not expose private tasks to a shared TV by default.
- Do not claim automated Web Push, store geofencing, inventory tracking or two-device sync is live without actual testing.

## FRIDAY ecosystem compatibility

[FRIDAY.md](FRIDAY.md) describes what can be shared in the future. The [FRIDAY coordination repo](https://github.com/vudh1/friday) owns common design and contracts.

1. For every new feature, ask whether another FRIDAY app has a concrete use. If not, record **No FRIDAY impact**; avoid unnecessary shared abstractions.
2. Keep the owning app's data and operations authoritative. No other app may directly read its encrypted state branch.
3. For useful cross-app behavior, identify producer, consumer, minimal data, privacy classification, opt-in consent, revocation, narrow scopes, failure fallback and cost.
4. Propose a **versioned, backward-compatible contract** in [FRIDAY](https://github.com/vudh1/friday), with stable source-qualified IDs, timezone/DST, update/delete, retries, staleness and safe-error rules. Cross-app writes need explicit authorization.
5. Preserve offline/standalone function if FRIDAY or a provider is down; keep design semantically consistent without forcing one UI library.
6. Follow the owning repo's review and release gates; test authorization, revocation, duplicates and failure paths. Report proposed, implemented, tested, deployed and device-verified separately.

For possible Vela Life reminders, resolve **how consent and a minimal projection work without weakening browser-side encryption** before coding. One-off ICS export is not an automatic FRIDAY feed.

## FRIDAY billing safety

Follow the [FRIDAY cardless cost policy](https://github.com/vudh1/friday/blob/main/docs/COST_POLICY.md). No new payment method, paid/free-converting trial, metered integration or free tier requiring a card by default. Verify official quotas and failure/overage behavior before changing AI, Cloudflare or sync usage; current tokens do not authorize billing. Code/CI cannot certify actual invoices. Cloudflare Zero Trust onboarding is on hold; the isolated FRIDAY admin Worker remains fail closed, and Kept's existing encrypted sync remains independent. See [staged Cloudflare notes](docs/FRIDAY_CLOUDFLARE.md).

## Release and verification

Use a focused branch/PR. Run the current repo's validation/tests; check offline use and encryption/merge/revocation when relevant. The `main` workflow can auto-publish Pages; Worker deployment is separate. Do not merge, deploy, change credentials or adopt paid services only to align FRIDAY. Report privacy, cost, compatibility, rollback and verified status.

## Licensing and provenance

Original project code/docs follow the root [Apache-2.0 license](LICENSE). Verify rights before importing third-party libraries, appliance manuals, images, manufacturers' content or generated assets. Preserve their required attribution and notices; do not relicense private household state or manufacturer marks. Licensing edits use a reviewed PR and do not independently authorize Pages/Worker deployment.
