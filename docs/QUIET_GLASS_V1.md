# Kept mobile design review — Quiet Glass v1

Status: **review proposal / PR only**. Nothing in this design document authorizes a production release, Worker deployment, or household reminder projection.

## Intent and coverage

Make the three everyday actions available with very little navigation:

| Flow | Interaction | Feedback |
| --- | --- | --- |
| Glance at maintenance | Open Today | “Needs attention” separates overdue/due work from “Soon”; status includes text, not color alone |
| Add or check off shopping | Type + Add on Today or Shopping; one tap on a row to check it | A small live-region success toast and immediate local list update |
| Complete or schedule care | “Done” on a due task, or “Schedule” to edit its date/interval | Completion toast and immediate due-state update; completion still writes history |
| Add appliance | Home → Add new → choose one of the existing catalog categories and starter tasks → Add appliance | Opens the new appliance detail with a persistent success banner and selected tasks |

Source-of-truth behavior is unchanged: shopping, appliances, schedules and maintenance history are still stored locally first, then optionally merged into the **client-encrypted** `runtime-state` ciphertext. Dates are calculated by the existing calendar-day logic. Calendar export, manual-backed Gemini drafts, Groq Q&A, catalog breadth and deletion tombstones are untouched.

## Token mapping

Values are copied into product CSS (no FRIDAY runtime import). They map the [FRIDAY Quiet Glass v1 proposal](https://github.com/vudh1/friday/blob/main/docs/DESIGN_SYSTEM.md) to Kept's existing components:

| Role | Light (default) | Dark | CSS |
| --- | --- | --- | --- |
| Canvas | `#F5F7F9` | `#0D121B` | `--background` |
| Base surface | `#FFFFFF` | `#18212E` | `--panel-solid` |
| Raised surface | `#E8EDF1` | `#243143` | `--panel-raised` |
| Primary text | `#131D29` | `#F4F6FA` | `--text` |
| Supporting text | `#4D5A68` | `#ADB7C5` | `--muted` |
| Kept accent | `#286A4A` | `#89D7AE` | `--accent` |
| Focus ring | `#205E8C` | `#BCEAFF` | `--focus` |

The sage `#89D7AE` is used as a friendly highlight in both modes. Functional surfaces use minimal strokes and lightweight depth. On this small iPhone UI, solid and near-solid surfaces avoid costly background blur.

## Screens and states

The screenshots below were captured in **390 × 844 mobile Chromium** from a local PWA using only a synthetic washer and a synthetic shopping item. They contain no real household data.

| Preview | Coverage |
| --- | --- |
| [Today · light](screenshots/today-light.png) | One due task, status, two-action maintenance card |
| [Today · dark](screenshots/today-dark.png) | Restrained graphite/sage alternate theme |
| [Shopping · light](screenshots/shopping-light.png) | One-line add, check-off, optional details |
| [Settings · light](screenshots/settings-light.png) | Theme, household status, backups, nested advanced configuration |
| [Settings · offline](screenshots/settings-offline.png) | Honest local-save/offline indication |
| [Settings · sync failure](screenshots/settings-sync-failed.png) | Mocked 503, “Sync needs attention” with no external service call |

The original first-run state uses a concise “All caught up” prompt and Add appliance action; the Shop list has a practical empty state. Unscheduled starter tasks are listed separately as “Ready when you are” and never receive fabricated due dates.

### Responsive and accessibility behavior

- Minimum target size 44 px for tab navigation, main buttons, shopping rows and settings controls. The bottom navigation respects the iPhone safe area; no delayed intro or blocking transitions.
- Visual grouping, font weight and written status distinguish Done / Soon / Due today / Overdue; no color-only meaning. `aria-current` identifies the active tab, row labels name the action and item/task, and a polite status region announces changes.
- Keyboard: Tab reaches each action and input; Enter submits add/edit forms; native dialog Escape closes and returns focus to the opener when still present. Form controls have explicit label associations. Dialog focus avoids automatically opening the iOS keyboard.
- Dynamic type: mobile Chromium smoke check tests 200% root text scaling for horizontal viewport overflow. Actual VoiceOver and physical iPhone keyboard checks remain pending.
- Reduced motion/transparency: existing `prefers-reduced-motion` behavior is preserved; cards do not require animation, and a solid-surface override is included for reduced transparency.
- Offline shell remains the service worker's existing allowlisted asset cache. Private local records and decrypted snapshots are never service-worker cached.

### Failure and privacy boundaries

- Offline saves remain local, with a visible “Offline · saved here” status. Returning online only initiates the existing sync when the required credentials and passphrase are present.
- “Sync needs attention” is a surfaced failure state, not a claim of recovery. Freshness shows a “Synced” timestamp **only after** a successful sync during the current session.
- The sync URL, access key and passphrase inputs remain functional for existing setups but are nested in advanced connection details, not part of normal everyday navigation. The passphrase remains memory-only and the shared token session-scoped.
- No Kept-to-Vela grants, opt-in consent controls, device identity, reminder publication, data projection activation or backend changes are in this PR.
- No Canva assets were used. The UI uses small self-contained SVG navigation icons and CSS shapes, requiring no third-party image license or network download. Existing Apache-2.0 licensing remains.

## Design tool handoff and verification gaps

A [Kept Figma file](https://www.figma.com/design/Wg8dne62ksSUKu6p5lj0GP) was created to host editable Today, Shopping, appliance, settings, first-run and failure flows. **Figma MCP rejected the first edit with the Starter-plan tool-call limit**, so that file does not yet contain completed editable designs. Do not mark the Figma acceptance check as passed. Use this spec and synthetic screenshots to resume after the connected plan's quota becomes available; do not buy an upgrade automatically.

Source test coverage includes core dates/AES-GCM/conflict merging, Friday security/projection boundaries, mocked DOM appliance setup, and Playwright shopping/maintenance/theme/offline/failed-sync workflows. Chromium was exercised locally at 390 × 844 and 430 × 932; WebKit is configured in CI but cannot be launched in this container without missing host libraries. CI results must be read from the PR before approval. No live two-device, cloud Worker, iPhone VoiceOver or production deployment verification is claimed.

## Review and rollback

Check 390/430 px iPhone layouts, large text, contrast, keyboard/VoiceOver, date/setup flows, no unauthorized network calls, and both themes. If rejected, close the PR or revert its UI-only commit. `main` is the GitHub Pages publication gate; **do not merge until reviewed**. The worker, `runtime-state` branch and separate FRIDAY grants remain unchanged.
