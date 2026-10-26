/**
 * Prepare an OWNER-APPROVED, MANUAL-ONLY FRIDAY auth preview deployment.
 *
 * Preflight reads the existing D1 database ID; it never creates resources,
 * changes billing, writes household data, or deploys a Worker. Secrets are
 * written only into a temporary chmod-0600 file on the ephemeral CI runner.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ACCOUNT_RE = /^[0-9a-f]{32}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_ID_RE = /^[1-9][0-9]{0,15}$/;
export const DATABASE_NAME = "kept-friday-reminders";
export const WORKER_NAME = "kept-friday-auth";
export const PREVIEW_ORIGIN = "https://kept-friday-auth.vudhone.workers.dev";

export function validatePreviewInput(input) {
  if (input.previewApproval !== "FRIDAY_FREE_PREVIEW" ||
      input.freePlanAttested !== "true" ||
      input.repository !== "vudh1/kept" ||
      input.repositoryOwner !== "vudh1" ||
      input.gitRef !== "refs/heads/main" ||
      !USER_ID_RE.test(input.actorId || "") ||
      input.actorId !== input.ownerId ||
      !ACCOUNT_RE.test(input.accountId || "") ||
      typeof input.d1Token !== "string" || input.d1Token.length < 24 ||
      typeof input.workerToken !== "string" || input.workerToken.length < 24 ||
      !/^[A-Za-z0-9_]{8,128}$/.test(input.githubClientId || "") ||
      typeof input.githubClientSecret !== "string" ||
      input.githubClientSecret.length < 24) {
    throw new Error("FRIDAY auth preview preflight failed; no Cloudflare changes.");
  }
}

export async function resolveExistingD1(input, request = fetch) {
  validatePreviewInput(input);
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${input.accountId}/d1/database`);
  url.searchParams.set("name", DATABASE_NAME);
  url.searchParams.set("per_page", "100");
  const response = await request(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.d1Token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`FRIDAY D1 read preflight failed (HTTP ${response.status}). No changes.`);
  const data = await response.json();
  if (data?.success !== true || !Array.isArray(data?.result) ||
      (Number.isInteger(data?.result_info?.total_pages) &&
       data.result_info.total_pages > 1)) {
    throw new Error("FRIDAY D1 preflight returned an unexpected result. No changes.");
  }
  const databases = data.result.filter((db) => db?.name === DATABASE_NAME);
  if (databases.length !== 1 || !UUID_RE.test(databases[0]?.uuid || "")) {
    throw new Error("Expected exactly one existing FRIDAY D1 database. No changes.");
  }
  return databases[0].uuid;
}

export function previewFiles(input, databaseId, random = randomBytes) {
  validatePreviewInput(input);
  if (!UUID_RE.test(databaseId)) throw new Error("Invalid existing D1 ID.");
  const rateLimitKey = random(48).toString("base64url");
  const config = `# Generated only by the owner's manual FRIDAY auth-preview workflow.
# Never use this configuration for Kept sync or Zero Trust.
name = "${WORKER_NAME}"
main = "index.js"
compatibility_date = "2026-10-25"
workers_dev = true

[vars]
PUBLIC_BASE_URL = "${PREVIEW_ORIGIN}"

[[d1_databases]]
binding = "AUTH_DB"
database_name = "${DATABASE_NAME}"
database_id = "${databaseId}"
`;
  const secrets = {
    GITHUB_CLIENT_ID: input.githubClientId,
    GITHUB_CLIENT_SECRET: input.githubClientSecret,
    ADMIN_GITHUB_IDS: JSON.stringify([Number(input.ownerId)]),
    RATE_LIMIT_KEY: rateLimitKey,
  };
  return { config, secrets };
}

export async function preparePreview(input, { request = fetch, random = randomBytes } = {}) {
  const databaseId = await resolveExistingD1(input, request);
  return previewFiles(input, databaseId, random);
}

function readInput() {
  return {
    previewApproval: process.env.FRIDAY_PREVIEW_APPROVAL,
    freePlanAttested: process.env.FRIDAY_WORKERS_FREE_ATTESTED,
    repository: process.env.GITHUB_REPOSITORY,
    repositoryOwner: process.env.GITHUB_REPOSITORY_OWNER,
    gitRef: process.env.GITHUB_REF,
    actorId: process.env.GITHUB_ACTOR_ID,
    ownerId: process.env.GITHUB_REPOSITORY_OWNER_ID,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    d1Token: process.env.CLOUDFLARE_D1_TOKEN,
    workerToken: process.env.CLOUDFLARE_API_TOKEN,
    githubClientId: process.env.FRIDAY_GITHUB_CLIENT_ID,
    githubClientSecret: process.env.FRIDAY_GITHUB_CLIENT_SECRET,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { config, secrets } = await preparePreview(readInput());
    const configPath = resolve("worker/friday-auth/wrangler.preview.generated.toml");
    const tempDir = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "friday-auth-preview-"));
    const secretsPath = join(tempDir, "secrets.json");
    writeFileSync(configPath, config, { mode: 0o600, flag: "wx" });
    writeFileSync(secretsPath, JSON.stringify(secrets), { mode: 0o600, flag: "wx" });
    chmodSync(secretsPath, 0o600);
    if (!process.env.GITHUB_OUTPUT) throw new Error("GitHub Actions output path is missing.");
    appendFileSync(process.env.GITHUB_OUTPUT,
      `config_path=${configPath}\nsecrets_path=${secretsPath}\n`);
    console.log("FRIDAY auth preview preflight passed; existing D1 located. No cloud mutation yet.");
  } catch (error) {
    // Never print configuration, secrets, bearer tokens or provider response bodies.
    console.error("FRIDAY auth preview preflight failed; no Cloudflare changes.");
    process.exitCode = 1;
  }
}
