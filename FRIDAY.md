# Kept × FRIDAY

Kept owns appliance maintenance, shopping and client-encrypted household data. [FRIDAY](https://github.com/vudh1/friday) coordinates optional cross-product interfaces; Kept remains local-first and independent.

## Integration register

| Capability | Status | Rule |
| --- | --- | --- |
| Local maintenance and shopping | **Existing** | Kept is canonical; no silent copying to FRIDAY. |
| One-off calendar/ICS export | **Existing** | Imported events do not automatically track later Kept changes. |
| Optional Cloudflare/GitHub encrypted sync | **Implemented in source; live configuration needs verification** | Client-side ciphertext is not a server-readable FRIDAY event source. |
| Vela Life reminders | **Local projection helper implemented; sharing not deployed** | `lib/friday-projection.js` creates a minimum read-only `event-v1` draft only from explicitly selected task IDs. UI selection, identity, per-device/profile grants, server storage, revocation and Vela consumption are not yet implemented. |
| Cross-app task completion/notification routing | **Proposed** | Needs identity, scoped action API, confirmation and rollback. |

## Reminder-projection safety boundary

The new [`projectFridayReminders`](lib/friday-projection.js) function runs only inside Kept's client-side trust boundary. It returns at most 20 (configurable, capped at 50) all-day maintenance events for **explicitly selected** tasks with active appliances, opaque UUIDs, valid due dates and safe, short titles. It carries no shopping records, appliance names/models, location, instructions, history or source URLs. It excludes older overdue events beyond the chosen window, unsafe title patterns and malformed inputs; the output follows the [FRIDAY draft event contract](https://github.com/vudh1/friday/tree/main/contracts). The caller must provide a valid IANA time zone and local date.

**This is not a functioning Kept-to-Vela feed:** it is not imported by the PWA, makes no network request, does not persist consent and has no server-side consumer grant. Do not attempt to use the current `SYNC_TOKEN`, TV remote PIN or an exported JSON file as cross-app authorization. First implement reviewed household identity/device pairing, grants, encryption-at-rest/retention and Vela display/revocation behavior, with independent tests and deployment. The owner has approved the *minimal data class* only, not a production service or paid resource.

## Safe future integration

- **Do not bypass client-side encryption.** FRIDAY or Vela may not read Kept's `runtime-state` branch, and existing shared tokens must not be repurposed as cross-app identity.
- Shared TV screens and ambient displays reveal no shopping, appliance or household details by default. Review visibility per profile/device and ensure revocation removes cached projections.
- If an approved integration is needed, define source-qualified IDs, schema version, due date/timezone/all-day behavior, status, update/delete, scopes, expiry, offline and duplicate semantics.
- Preserve local maintenance/shopping behavior during FRIDAY/Worker outages. No new backend, plaintext storage, recurring fee or cross-app write is authorized by this file.
- At feature review, choose **No FRIDAY impact** when appropriate; otherwise track owner, consumer, security boundaries and contract in [FRIDAY issues](https://github.com/vudh1/friday/issues).

See [AGENTS.md](AGENTS.md) and [FRIDAY architecture](https://github.com/vudh1/friday/blob/main/docs/ARCHITECTURE.md).
