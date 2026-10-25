# Kept × FRIDAY

Kept owns appliance maintenance, shopping and client-encrypted household data. [FRIDAY](https://github.com/vudh1/friday) coordinates optional cross-product interfaces; Kept remains local-first and independent.

## Integration register

| Capability | Status | Rule |
| --- | --- | --- |
| Local maintenance and shopping | **Existing** | Kept is canonical; no silent copying to FRIDAY. |
| One-off calendar/ICS export | **Existing** | Imported events do not automatically track later Kept changes. |
| Optional Cloudflare/GitHub encrypted sync | **Implemented in source; live configuration needs verification** | Client-side ciphertext is not a server-readable FRIDAY event source. |
| Vela Life reminders | **Proposed** | Needs explicit consent and profile-scoped, minimized, authorized projections. |
| Cross-app task completion/notification routing | **Proposed** | Needs identity, scoped action API, confirmation and rollback. |

## Safe future integration

- **Do not bypass client-side encryption.** FRIDAY or Vela may not read Kept's `runtime-state` branch, and existing shared tokens must not be repurposed as cross-app identity.
- Shared TV screens and ambient displays reveal no shopping, appliance or household details by default. Review visibility per profile/device and ensure revocation removes cached projections.
- If an approved integration is needed, define source-qualified IDs, schema version, due date/timezone/all-day behavior, status, update/delete, scopes, expiry, offline and duplicate semantics.
- Preserve local maintenance/shopping behavior during FRIDAY/Worker outages. No new backend, plaintext storage, recurring fee or cross-app write is authorized by this file.
- At feature review, choose **No FRIDAY impact** when appropriate; otherwise track owner, consumer, security boundaries and contract in [FRIDAY issues](https://github.com/vudh1/friday/issues).

See [AGENTS.md](AGENTS.md) and [FRIDAY architecture](https://github.com/vudh1/friday/blob/main/docs/ARCHITECTURE.md).
