import test from "node:test";
import assert from "node:assert/strict";
import { parseAdminEmails, handleRequest } from "../worker/friday-admin/index.js";
import { accessPolicyFor, ensureFridayAccess } from "../scripts/provision-friday-access.mjs";

const owner = "owner@example.com";
const jsonList = JSON.stringify([owner, "Second@example.org"]);
const accountId = "a".repeat(32);
const workerTag = "f".repeat(32);
const req = new Request("https://example.workers.dev/health");

test("exact private email allowlist normalizes and rejects broad/invalid rules", () => {
  assert.deepEqual(parseAdminEmails(jsonList), [owner, "second@example.org"]);
  for (const invalid of [undefined, "", "{}", "[]", '["*"]',
    '["@example.com"]', '["example.com"]', '["owner@example.com", "OWNER@example.com"]',
    '["owner@example.com", 4]', JSON.stringify(Array(11).fill(owner))]) {
    assert.throws(() => parseAdminEmails(invalid));
  }
});

test("new Worker fails closed before Access and on broken configuration", async () => {
  const badConfig = await handleRequest(req, { ADMIN_EMAILS: "[]" }, {});
  assert.equal(badConfig.status, 503);
  const missingIdentity = await handleRequest(req, { ADMIN_EMAILS: jsonList }, {});
  assert.equal(missingIdentity.status, 403);
  const throwingIdentity = await handleRequest(req, { ADMIN_EMAILS: jsonList }, {
    access: { getIdentity: async () => { throw new Error("private details"); } },
  });
  assert.equal(throwingIdentity.status, 403);
  assert.doesNotMatch(await throwingIdentity.text(), /private|example\.com/);
});

test("Worker allows only an exact Access identity, exposes no data and no other route", async () => {
  const env = { ADMIN_EMAILS: jsonList };
  const denied = await handleRequest(req, env, { access: { getIdentity: async () => ({ email: "attacker@example.net" }) } });
  assert.equal(denied.status, 403);
  const ctx = { access: { getIdentity: async () => ({ email: "OWNER@example.com" }) } };
  const allowed = await handleRequest(req, env, ctx);
  assert.equal(allowed.status, 200);
  const body = await allowed.text();
  assert.deepEqual(JSON.parse(body), { ok: true, service: "kept-friday-admin", sharingEnabled: false });
  assert.doesNotMatch(body, /owner@|reminder|token/i);
  assert.equal(allowed.headers.get("Cache-Control"), "no-store");
  assert.equal((await handleRequest(new Request("https://example.workers.dev/list"), env, ctx)).status, 404);
  assert.equal((await handleRequest(new Request("https://example.workers.dev/health", { method: "POST" }), env, ctx)).status, 404);
});

test("Access policy is confined to one immutable Worker and exact named emails", () => {
  const policy = accessPolicyFor(workerTag, parseAdminEmails(jsonList));
  assert.equal(policy.type, "self_hosted");
  assert.deepEqual(policy.destinations, [{ type: "worker", worker_id: workerTag }]);
  assert.equal(policy.session_duration, "1h");
  assert.equal(policy.policies[0].decision, "allow");
  assert.deepEqual(policy.policies[0].include, [
    { email: { email: owner } }, { email: { email: "second@example.org" } },
  ]);
  assert.doesNotMatch(JSON.stringify(policy), /everyone|bypass|email_domain|kept-sync/);
  assert.throws(() => accessPolicyFor("invalid", [owner]));
});

function mockApi({ scriptId = "kept-friday-admin", apps = [], onRequest } = {}) {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    onRequest?.(url, options);
    let result;
    if (url.endsWith("/workers/scripts")) result = [{ id: scriptId, tag: workerTag }];
    else if (url.includes("/access/apps?") && options.method === "GET") result = apps;
    else if (url.endsWith("/access/apps") && options.method === "POST") result = { id: "created" };
    else throw Error("Unexpected API request");
    return { ok: true, json: async () => ({ success: true, result }) };
  };
  return { calls, request };
}

test("Access provisioning creates only the dedicated Worker policy", async () => {
  const api = mockApi();
  const result = await ensureFridayAccess({
    accountId, workersToken: "workers-token", accessToken: "access-token", adminEmailsJson: jsonList,
    request: api.request,
  });
  assert.deepEqual(result, { created: true, needsReview: false });
  assert.equal(api.calls.length, 3);
  assert.equal(api.calls[0].options.headers.Authorization, "Bearer workers-token");
  assert.equal(api.calls[1].options.headers.Authorization, "Bearer access-token");
  const body = JSON.parse(api.calls[2].options.body);
  assert.deepEqual(body.destinations, [{ type: "worker", worker_id: workerTag }]);
  assert.deepEqual(body.policies[0].include, [
    { email: { email: owner } }, { email: { email: "second@example.org" } },
  ]);
});

test("Access provisioning never overrides existing policy or deploys over missing Worker", async () => {
  const base = { accountId, workersToken: "worker-token", accessToken: "access-token", adminEmailsJson: jsonList };
  const existing = mockApi({ apps: [{ name: "Kept FRIDAY administrators", id: "existing" }] });
  assert.deepEqual(await ensureFridayAccess({ ...base, request: existing.request }), {
    created: false, needsReview: true,
  });
  assert.equal(existing.calls.length, 2);
  const missing = mockApi({ scriptId: "kept-sync" });
  await assert.rejects(ensureFridayAccess({ ...base, request: missing.request }), /absent/);
  assert.equal(missing.calls.length, 1);
  const overlap = mockApi({ apps: [{ name: "Other Access app", destinations: [{ type: "worker", worker_id: workerTag }] }] });
  await assert.rejects(ensureFridayAccess({ ...base, request: overlap.request }), /already targets this Worker/);
  assert.equal(overlap.calls.length, 2);
  const invalid = mockApi();
  await assert.rejects(ensureFridayAccess({ ...base, adminEmailsJson: "[]", request: invalid.request }), /allowlist/);
  assert.equal(invalid.calls.length, 0);
});

test("Access API permission failure is explicit and contains no private response", async () => {
  const api = mockApi({ onRequest: () => {} });
  const denied = async (url, opts) => {
    if (url.includes("/access/apps?")) return {
      ok: false, status: 403, text: async () => "secret: owner@example.com",
    };
    return api.request(url, opts);
  };
  await assert.rejects(ensureFridayAccess({
    accountId, workersToken: "worker-token", accessToken: "access-token", adminEmailsJson: jsonList, request: denied,
  }), (error) => error.message === "Cloudflare Access application discovery failed (HTTP 403).");
  const workerDenied = async () => ({ ok: false, status: 403 });
  await assert.rejects(ensureFridayAccess({
    accountId, workersToken: "worker-token", accessToken: "access-token", adminEmailsJson: jsonList, request: workerDenied,
  }), (error) => error.message === "Cloudflare Worker script discovery failed (HTTP 403).");
});
