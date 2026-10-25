/**
 * Idempotently provision an EMPTY, dedicated D1 database for a future Kept
 * -> Vela reminder integration. Never accepts or stores household records.
 *
 * Requires Cloudflare API token permissions: D1 Read and D1 Write on the
 * selected account. A failed preflight makes no changes.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const DATABASE_NAME = "kept-friday-reminders";
const ACCOUNT_RE = /^[0-9a-f]{32}$/i;
const DATABASE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function ensureFridayDatabase({ accountId, apiToken, request = fetch }) {
  if (typeof accountId !== "string" || !ACCOUNT_RE.test(accountId)) {
    throw new Error("Cloudflare account ID is missing or invalid.");
  }
  if (typeof apiToken !== "string" || apiToken.length < 24) {
    throw new Error("Cloudflare D1 API token is missing or invalid.");
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`;
  const call = async (method, url, body) => {
    const response = await request(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000)
    });
    // Do not print Cloudflare error bodies, which might contain account details.
    if (!response.ok) throw new Error(`Cloudflare D1 ${method} failed (HTTP ${response.status}); check D1 Read/Write scope.`);
    const result = await response.json();
    if (result?.success !== true) throw new Error(`Cloudflare D1 ${method} did not succeed.`);
    return result.result;
  };

  const matching = await call("GET", `${endpoint}?name=${encodeURIComponent(DATABASE_NAME)}`);
  if (!Array.isArray(matching)) throw new Error("Cloudflare D1 returned an invalid database list.");
  const found = matching.filter(db => db?.name === DATABASE_NAME);
  if (found.length > 1) throw new Error("Multiple databases have the reserved FRIDAY name.");
  if (found.length) {
    if (!DATABASE_ID_RE.test(found[0]?.uuid || "")) throw new Error("Existing D1 database ID is invalid.");
    return { created: false, databaseId: found[0].uuid, name: DATABASE_NAME };
  }

  const created = await call("POST", endpoint, {
    name: DATABASE_NAME,
    read_replication: { mode: "disabled" }
  });
  if (created?.name !== DATABASE_NAME || !DATABASE_ID_RE.test(created?.uuid || "")) {
    throw new Error("Cloudflare D1 created an unexpected database; inspect the account before retrying.");
  }
  return { created: true, databaseId: created.uuid, name: DATABASE_NAME };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await ensureFridayDatabase({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN
    });
    // Database ID is not a secret, but keep public CI logs infrastructure-minimal.
    console.log(result.created
      ? "Created isolated, empty Kept FRIDAY D1 database. No sharing service has been deployed."
      : "Kept FRIDAY D1 database already exists. No sharing service has been deployed.");
  } catch (error) {
    console.error(String(error?.message || "D1 provision failed").slice(0, 200));
    process.exitCode = 1;
  }
}
