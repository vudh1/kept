# kept. — Home, handled.

**Kept** is a small iPhone-first household PWA inspired by BallerWatch's navy glassmorphism UI. Track appliances, review maintenance due dates, and keep a shopping list with a partner. Its offline, local-first interface is functional without any cloud credentials. An optional Cloudflare Worker synchronizes **client-encrypted** household state into a dedicated orphan `runtime-state` GitHub branch.

**FRIDAY:** [Integration ownership and compatibility](FRIDAY.md) · [Agent instructions](AGENTS.md).

> **Status:** v0.1 foundation with automated GitHub Pages publication. Shopping and maintenance screens, schedules, history, local persistence, encrypted GitHub sync code, Gemini manual research drafts, and Groq Q&A are implemented. Deployment, shared sync, and AI **require your own configuration and API keys**. Native timed Web Push, live store arrival geofencing, and retailer inventory crawling are **not implemented**. Calendar export provides basic iPhone reminders until Web Push is ready.

## Features

- iPhone PWA; glass design, safe-area nav, installable home screen, offline app shell.
- Grocery/shopping list: add, edit, remove, check off, quantities, preferred stores, and store filters.
- Appliance catalog with 15 common categories and **general starter tasks only**; record brand/model, room, manual link, and last-maintenance date.
- Maintenance: flexible day intervals, overdue/soon views, completion history, optional calendar event export (single upcoming occurrences, with alert one day early).
- Offline local device database and an **opt-in** encrypted two-device sync. GitHub stores a single AES-256-GCM envelope, not readable shopping data.
- AI research: Gemini reads a user-provided HTTPS public manual link and creates **review-required** drafts with evidence excerpts. Tasks with unsupported intervals are excluded. It never silently applies updates.
- Groq assistant for generic maintenance Q&A; household shopping/history is not sent to models by default.
- Node unit tests for date handling, AES-GCM, merges, authentication, and URL validation.

## Try Kept locally

```sh
npm run check
python3 -m http.server 4173
# visit http://localhost:4173
```

The app works without a backend on one device. It stores local data in browser `localStorage` (plaintext inside browser origin storage). Do not treat it as a secure or durable sole backup; clearing browser site data removes it. Use the Settings → Export JSON backup action to keep a copy **securely**; the export is intentionally unencrypted.

## Publish PWA

The [Publish Kept workflow](.github/workflows/pages.yml) validates the app, packages only the public PWA files (not the Worker, documentation, or tests), and deploys them to **GitHub Pages** automatically after each push to `main`. GitHub repository **Settings → Pages → Build and deployment → Source** must be set to **GitHub Actions**. You can also run the workflow manually from **Actions → Publish Kept → Run workflow**.

Your project URL is **https://vudh1.github.io/kept/** after the deployment succeeds. All PWA asset, manifest, and service-worker paths are relative to `/kept/`. Install on iPhone via Safari → Share → **Add to Home Screen**.

Both people must install from the same web origin. Without sync configured, each device has its **own** local list; it is not automatically shared.

## Configure encrypted shared sync

1. **Public repository / encrypted storage:** Kept now uses the isolated **`runtime-state` branch in this same `vudh1/kept` repository**, matching BallerWatch's branch layout. The branch is initialized independently of `main` (orphan history) and only `state.json` is permitted; the browser encrypts the entire household state before uploading. There is no plaintext JSON on GitHub. **Important:** because the repository is public, anyone can download the encrypted snapshot, view its historical versions and commit timestamps, and attempt offline passphrase guesses. Use a **unique, high-entropy passphrase** (for example 6 randomly chosen Diceware words, not a reused password) and treat the public encrypted branch as less private than a separate private repository. You may switch to a private data repository later without changing the app data format. Create a fine-grained GitHub PAT scoped to `vudh1/kept` with **Contents: Read and write** for the Cloudflare Worker (GitHub does not offer branch-only restrictions for these credentials). Never expose the PAT in your frontend or Git commits.
2. Install Cloudflare Wrangler using `npx wrangler` and authenticate (`npx wrangler login`); deploy from `worker/`:

   ```sh
   cd worker
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put SYNC_TOKEN
   # SYNC_TOKEN should be unique and at least 24 random characters
   npx wrangler deploy
   ```

3. In `worker/wrangler.toml`, set `ALLOWED_ORIGIN` to your PWA's **origin** (e.g. `https://vudh1.github.io`, *not* `/kept/`). The origin must be HTTPS for deployed use. Keep `GITHUB_REPO = "vudh1/kept"` and `GITHUB_BRANCH = "runtime-state"`. If the branch does not yet exist, the first encrypted sync creates an **orphan root commit** containing only `state.json`; if the empty branch is already initialized, the first sync writes that file. Every read audits the root directory and refuses any extra files.
4. On **each iPhone**, open Kept → Settings. Enter Worker URL (`https://kept-sync.<your-subdomain>.workers.dev`), same **SYNC_TOKEN**, and the same strong **household encryption passphrase** (12+ characters; 5–6 random words preferred). Tap **Save & sync now**. The password is deliberately memory-only; reenter it after app reload/restart. Access token is session-only (cleared after browser session).
5. Try editing the shopping list on device A, unlock and sync device B, and verify both lists merge. When unlocked, Kept syncs after changes, after returning to the app, and every minute while visible.

**Security and conflict policy:** User content is encrypted in the browser with PBKDF2-SHA256 (310,000 iterations) and AES-256-GCM with random salt/nonce per snapshot; the passphrase is never transmitted to the Worker. The Worker gates reads/writes with a long shared sync token and CORS origin allowlist; GitHub token is Worker-only. GitHub writes use an expected SHA and explicit 409 conflicts. Branch history is encrypted-only after initialization, but normal GitHub updates preserve old ciphertext commits; unlike BallerWatch's history-replacing runtime snapshots, Kept does not yet rewrite branch history. The client refetches, decrypts, merges individual entities, and retries. Concurrent edits to the **same record** use latest `updatedAt` then `updatedBy`; concurrent edits to **different records** merge. Clocks drifting substantially may cause inaccurate conflict resolution. Deletes use tombstones. A future version should improve per-field merges and add compaction/versioning.

**Threat model:** This is a **public Git repository**, so ciphertext and Git commit metadata are publicly accessible indefinitely. The GitHub branch holds ciphertext, but the device has plaintext in `localStorage` and in memory. Compromise of the browser origin, device, access token, or a guessed passphrase may leak data. Enforce CSP and avoid third-party scripts in production. Losing the passphrase means you cannot recover the remote state. The shared Worker token does not uniquely identify each person; household member invites/individual tokens are future work. Periodic sync incurs GitHub API requests/commits; this small-household design is not a large-scale database.

## Enable opt-in AI research and chat

```sh
cd worker
npx wrangler secret put GEMINI_API_KEY  # optional
npx wrangler secret put GROQ_API_KEY    # optional
npx wrangler deploy
```

You may edit `GEMINI_MODEL` and `GROQ_MODEL` in `worker/wrangler.toml` to an available model on your account. AI features are disabled until credentials are set. The manual researcher requires a **brand, model, and public HTTPS manual URL**. Its suggestion is a **draft**, not verified manufacturer instruction. All tasks added from AI remain unscheduled until you enter the date maintenance was last performed. A returned source excerpt is included in task instructions for review. Avoid uploading private receipts, addresses, photos, or serial numbers to free-tier AI services. Provider rate limits, terms, and free eligibility can change.

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

Kept is designed to give you a dependable household app without requiring an AI model for every reminder or task. **Manufacturer documentation takes priority** over starter templates and model-generated drafts.
