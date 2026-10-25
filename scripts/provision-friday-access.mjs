import { parseAdminEmails } from "../worker/friday-admin/index.js";
import { fileURLToPath } from "node:url";

const WORKER_NAME = "kept-friday-admin";
const APP_NAME = "Kept FRIDAY administrators";
const API = "https://api.cloudflare.com/client/v4";
const hex32 = /^[a-f0-9]{32}$/i;

export function accessPolicyFor(workerTag, emails) {
  if (!hex32.test(workerTag)) throw new Error("Invalid Worker tag.");
  if (!Array.isArray(emails) || !emails.length) throw new Error("Missing exact email allowlist.");
  return {
    name: APP_NAME,
    type: "self_hosted",
    destinations: [{ type: "worker", worker_id: workerTag }],
    session_duration: "1h",
    policies: [{
      name: "Allow named Kept administrators",
      decision: "allow",
      include: emails.map((email) => ({ email: { email } })),
    }],
  };
}

async function cfRequest(request, path, token, method = "GET", body, operation = "request") {
  const response = await request(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    // Never print response bodies; API errors can contain identifying details.
    throw new Error(`Cloudflare ${operation} failed (HTTP ${response.status}).`);
  }
  const payload = await response.json();
  if (payload?.success !== true) {
    throw new Error(`Cloudflare ${operation} did not succeed.`);
  }
  return payload;
}

export async function ensureFridayAccess({ accountId, workersToken, accessToken, adminEmailsJson, request = fetch }) {
  if (!hex32.test(accountId ?? "")) throw new Error("Missing or invalid account ID.");
  if (!workersToken || !accessToken) throw new Error("Missing Cloudflare API permission token.");
  const emails = parseAdminEmails(adminEmailsJson);
  const base = `/accounts/${accountId}`;

  const workers = await cfRequest(request, `${base}/workers/scripts`, workersToken,
    "GET", undefined, "Worker script discovery");
  const scripts = workers.result;
  if (!Array.isArray(scripts)) throw new Error("Could not inspect isolated Workers.");
  const exactWorker = scripts.filter((worker) => worker.id === WORKER_NAME);
  if (exactWorker.length !== 1 || !hex32.test(exactWorker[0].tag ?? "")) {
    throw new Error("Isolated admin Worker is absent or missing its immutable tag.");
  }

  const apps = await cfRequest(request, `${base}/access/apps?page=1&per_page=100`, accessToken,
    "GET", undefined, "Access application discovery");
  if (!Array.isArray(apps.result) ||
      (apps.result_info && apps.result_info.total_pages > 1)) {
    throw new Error("Cannot verify all existing Access applications; refusing changes.");
  }
  const existing = apps.result.filter((app) => app.name === APP_NAME);
  if (existing.length > 1) throw new Error("Duplicate Access application names; manual review required.");
  if (existing.length === 1) {
    // No silent policy overwrite: policy changes require an explicit review.
    return { created: false, needsReview: true };
  }
  if (apps.result.some((app) => app.destinations?.some(
    (destination) => destination.type === "worker" &&
      destination.worker_id === exactWorker[0].tag,
  ))) {
    throw new Error("An Access application already targets this Worker; manual review required.");
  }

  const expected = accessPolicyFor(exactWorker[0].tag, emails);
  const created = await cfRequest(request, `${base}/access/apps`, accessToken,
    "POST", expected, "Access application creation");
  if (!created.result?.id) throw new Error("Access API did not confirm application creation.");
  return { created: true, needsReview: false };
}

async function main() {
  if (process.argv.includes("--validate-only")) {
    parseAdminEmails(process.env.ADMIN_EMAILS);
    console.log("Private named administrator allowlist is syntactically valid.");
    return;
  }
  const result = await ensureFridayAccess({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    workersToken: process.env.CLOUDFLARE_WORKERS_TOKEN,
    accessToken: process.env.CLOUDFLARE_ACCESS_TOKEN,
    adminEmailsJson: process.env.ADMIN_EMAILS,
  });
  if (result.needsReview) {
    throw new Error("Access application already exists; verify its destination and policy manually before proceeding.");
  }
  console.log(result.created
    ? "Access protection created for isolated Kept administrator Worker. No reminder sharing enabled."
    : "Access protection verified. No reminder sharing enabled.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : "Access provisioning failed.");
    process.exitCode = 1;
  });
}
