# kept. — Home, handled.

**Kept** is a small iPhone-first household PWA inspired by BallerWatch's navy glassmorphism UI. Track appliances, review maintenance due dates, and keep a shopping list with a partner. Its offline, local-first interface is functional without any cloud credentials. A Cloudflare Worker is available for opt-in **client-encrypted** household synchronization to the isolated `runtime-state` GitHub branch. A separate PIN-gated trusted-device upgrade is staged for release.

**FRIDAY:** [Integration ownership and compatibility](FRIDAY.md) · [Agent instructions](AGENTS.md).

> **Status:** v0.1 live; PIN-only household access and automatic sync are in draft PR #10, not yet deployed. Shopping and maintenance screens, schedules, history, local persistence, encrypted GitHub sync code, Gemini manual research drafts, and Groq Q&A are implemented. Deployment, shared sync, and AI **require your own configuration and API keys**. Native timed Web Push, live store arrival geofencing, and retailer inventory crawling are **not implemented**. Calendar export provides basic iPhone reminders until Web Push is ready.

## Features

- iPhone PWA; glass design, safe-area nav, installable home screen, offline app shell.
- Grocery/shopping list: add, edit, remove, check off, quantities, preferred stores, and store filters.
- Appliance catalog with **31 named categories plus Other** and editable general starter tasks. Choose category first, select relevant tasks, optionally enter a last-maintenance date. Brand/model/manual are tucked under optional details; no AI required.
- Maintenance: flexible day intervals, overdue/soon views, completion history, optional calendar event export (single upcoming occurrences, with alert one day early).
- Offline local device database and an **opt-in** encrypted two-device sync (PIN upgrade is not live until deployed). GitHub stores a single AES-256-GCM envelope, not readable shopping data.
- AI research is an optional advanced step: Gemini reads a user-provided HTTPS public manual link and creates **review-required** drafts with evidence excerpts. Tasks with unsupported intervals are excluded. It never silently applies updates.
- Groq assistant for generic maintenance Q&A; household shopping/history is not sent to models by default.
- Node unit tests for date handling, AES-GCM, merges, authentication, and URL validation.

## Try Kept locally

```sh
npm run check
python3 -m http.server 4173
# visit http://localhost:4173
```

The currently live app works without a backend on one device. It stores local data in browser `localStorage` (plaintext inside browser origin storage). The staged PIN upgrade migrates these records to encrypted IndexedDB after authenticated setup. Do not treat it as a secure or durable sole backup; clearing browser site data removes it. Use the Settings → Export JSON backup action to keep a copy **securely**; the export is intentionally unencrypted.

## Publish PWA

The [Publish Kept workflow](.github/workflows/pages.yml) validates the app, packages only the public PWA files (not the Worker, documentation, or tests), and deploys them to **GitHub Pages** automatically after each push to `main`. GitHub repository **Settings → Pages → Build and deployment → Source** must be set to **GitHub Actions**. You can also run the workflow manually from **Actions → Publish Kept → Run workflow**.

Your project URL is **https://vudh1.github.io/kept/** after the deployment succeeds. All PWA asset, manifest, and service-worker paths are relative to `/kept/`. Install on iPhone via Safari → Share → **Add to Home Screen**.

Both people must install from the same web origin. Without sync configured, each device has its **own** local list; it is not automatically shared.

## Secure household access and shared sync (staged rollout)

The proposed PIN-based access is developed in **draft PR #10**. It is **not active in production until the Worker and Pages have both been deployed after review**. The currently live Kept UI continues to use local data without this new login.

**New-device flow:** first visit asks for an **8–12-digit household PIN**. Cloudflare verifies the PIN in a SQLite-backed Durable Object with failed-attempt limits (five wrong attempts lock the household for 15 minutes). On success it issues a random 256-bit device credential and a **separate random 256-bit household data key**. Kept stores a nonextractable WebCrypto key and device credential in IndexedDB. It encrypts the local inventory and public GitHub snapshot with AES-256-GCM; the PIN never becomes the encryption key. Reopening a trusted iPhone does **not** require the PIN. New-device enrollment requires internet; trusted devices can browse and edit encrypted local data offline.

**Required one-time GitHub Actions secrets** (repository **Settings → Secrets and variables → Actions** or the **production** environment; never add values to source, issue comments, or chat):

- `KEPT_INITIAL_PIN`: choose your household's **8–12 numeric digits**, ideally 10–12 random digits; use only for Kept. Kept Settings lets an authorized device change it later, revoking old trusted device sessions. Do not use your phone passcode.
- `KEPT_PIN_PEPPER`: generate using `openssl rand -hex 32` and save the output. The pepper never goes to the browser.
- Existing deployment secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `KEPT_GITHUB_PAT` (Contents read/write), and optional `GROQ_API_KEY` / `GEMINI_API_KEY`.

`KEPT_SYNC_TOKEN` is **retired by the new Worker source**. Old deployed Workers may still accept it until replaced. Remove or rotate the old secret after the authenticated Worker is confirmed live.

**Safe release order:**
1. Add `KEPT_INITIAL_PIN` and `KEPT_PIN_PEPPER` secrets in GitHub; never paste them in a message.
2. Deploy the Worker **from the feature branch** using Actions → **Deploy Kept Cloudflare Worker** → **Run workflow** → choose `feature/pin-device-auth-sync`. Existing production frontend continues working until the new one ships. Confirm `/api/health` works and unauthenticated `/api/state` returns 401.
3. After PR checks pass, merge the feature into `main`; the Pages workflow publishes the PIN screen. Open Kept in Safari, enter the PIN once, and verify that existing local items are migrated **only after encrypted IndexedDB persistence succeeds**.
4. Pair the second iPhone with the same PIN. Test changing a shopping item on one and seeing it on the other after sync. Test offline editing and reconnection. Do not delete website data or uninstall before checking the migration.

The client uses the configured service URL `https://kept-sync.vudhone.workers.dev`, never an editable URL, GitHub PAT or shared API token in Settings.

**Privacy and recovery:** the `runtime-state` branch is **public** and stores only ciphertext, but its commit history/timestamps remain public. The Worker can deliver the data key to authorized devices, so this is **Cloudflare-managed encryption, not end-to-end encryption against Cloudflare**. A stolen or compromised trusted device and injected same-origin code can access local content; offline devices cannot learn revocation until reconnecting. Do not treat the PIN as complete user authentication or encrypted-key recovery. Export a JSON backup to a safe location; backup exports are unencrypted. Losing all trusted-device records and the Durable Object's random key can make public ciphertext unrecoverable. A dedicated independent recovery-key flow is future work.

**Offline first:** after one successful enrollment, browse and finish tasks offline. Sync/API failures must never prevent local edits, and reminders continue to be calculated locally. Automated background iPhone push, geofencing and retailer stock detection are separate future features. No FRIDAY shared information is exposed by this update.

## Reminders, store detection, and inventory — honest limitations

- **Available now:** maintenance due/overdue shown in-app; export the next occurrence of each scheduled maintenance item as an `.ics` Calendar file. Future changes in Kept **do not update** already imported calendar events. Import and accept alerts using iPhone Calendar as supported by your device.
- **Not yet:** background Web Push. Apple supports push in installed Home Screen web apps on iOS 16.4+, but it requires a VAPID subscription service and periodic notification scheduler. Service worker contains a future-facing push handler; there is **no** implemented sender/subscription workflow. Do not expect automatic iPhone alerts while the app is closed.
- **Not yet:** reliable store geofence and check-in. iOS PWAs cannot guarantee background location; Apple Shortcuts arrival automations or a native companion app are possible next steps. Nothing collects GPS in the current app.
- **Not yet:** store stock checking. There is **no** inventory crawler, Target/Costco integration, inventory accuracy claim, or automated purchases.

## Roadmap

1. Production readiness: full device/browser smoke tests, authenticated per-device invitations, accessible UI, encrypted local storage and recovery flows, sync throttling and backups.
2. iOS Web Push: device subscriptions, VAPID sender, server-side *minimal* due-date metadata, cron, and privacy-safe notifications.
3. Optional geofence bridging via iOS Shortcuts for saved stores and deduped notifications.
4. Retail integrations via supported sources, stock confidence levels, and audit timestamps (avoid unsupported scraping).
5. Photo/barcode model detection and reviewed manufacturer sources; per-filter reorder links.

## Privacy and code layout

- `index.html`, `styles.css`, `app.js`: PWA UI and interactions.
- `lib/catalog.js`: general editable maintenance templates.
- `lib/schedules.js`: deterministic calendar-day arithmetic and ICS export.
- `lib/store.js`: local persistence, per-record merges/tombstones.
- `lib/crypto.js`: client-side AES-GCM envelope encryption.
- `lib/sync.js`: client ciphertext sync and AI transport.
- `worker/index.js`: Cloudflare auth, GitHub ciphertext bridge, opt-in Gemini/Groq endpoints.
- `tests`: pure logic and security boundary checks.

Kept provides an offline category-first baseline without calling any AI service. Existing appliance schedules are not silently rewritten when the built-in catalog changes. Review source links, disable inapplicable tasks, and adjust intervals according to your manual and household usage. No FRIDAY integration is added by this catalog enhancement.

Kept is designed to give you a dependable household app without requiring an AI model for every reminder or task. **Manufacturer documentation takes priority** over starter templates and model-generated drafts.
