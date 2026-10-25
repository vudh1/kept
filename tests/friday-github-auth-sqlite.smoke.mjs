// Optional developer smoke test: Node 24+ built-in SQLite. Not a Cloudflare
// D1 integration test and not part of the default Node >=20 CI test glob.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleRequest } from "../worker/friday-auth/index.js";

const origin = "https://staged.example.workers.dev";
const sql = readFileSync(new URL("../worker/friday-auth/schema.sql", import.meta.url), "utf8");
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(sql);

// Mirrors the narrow D1 prepare/bind/first/run surface used by this Worker.
const AUTH_DB = {
  prepare(statement) {
    return {
      bind(...args) {
        const stmt = sqlite.prepare(statement);
        return {
          async first() { return stmt.get(...args) || null; },
          async run() { return stmt.run(...args); },
        };
      },
    };
  },
};

const env = {
  AUTH_DB,
  PUBLIC_BASE_URL: origin,
  ADMIN_GITHUB_IDS: "[12345]",
  GITHUB_CLIENT_ID: "Ov23liExampleClientId",
  GITHUB_CLIENT_SECRET: "placeholder-secret-at-least-24-chars",
  RATE_LIMIT_KEY: "placeholder-rate-key-at-least-32-characters",
};
const startAt = Date.UTC(2026, 9, 25, 12, 0, 0);
let now = startAt;
const calls = [];
const deps = {
  now: () => now,
  fetch: async (url, opts) => {
    calls.push(url);
    assert.ok(opts.signal);
    return { ok: true, json: async () => url.includes("oauth/access_token")
      ? { access_token: "test-token-not-persisted", token_type: "bearer", scope: "read:user" }
      : { id: 12345 } };
  },
};
const get = (path, cookie) => handleRequest(new Request(origin + path, {
  headers: { Cookie: cookie || "", "CF-Connecting-IP": "198.51.100.5" },
}), env, deps);
const post = (path, cookie) => handleRequest(new Request(origin + path, {
  method: "POST", headers: { Cookie: cookie, Origin: origin },
}), env, deps);

const start = await get("/auth/start");
assert.equal(start.status, 302);
const redirect = new URL(start.headers.get("Location"));
const state = redirect.searchParams.get("state");
const flowCookie = start.headers.get("Set-Cookie").split(";")[0];
const callback = `/auth/callback?state=${state}&code=one-time-code`;
const signedIn = await get(callback, flowCookie);
assert.equal(signedIn.status, 303);
assert.equal(calls.length, 2);
const authCookie = signedIn.headers.get("Set-Cookie")
  .split(/,\s*(?=__Host-)/).find((s) => s.startsWith("__Host-kept_friday_session="))?.split(";")[0];
assert.ok(authCookie);
assert.equal((await get("/auth/status", authCookie)).status, 200);

// SQLite enforces the state consume exactly once, and the session is kept as a
// hashed key in D1's proposed schema. Raw GitHub bearer tokens are not stored.
assert.equal((await get(callback, flowCookie)).status, 403);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM friday_auth_flows").get().n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM friday_auth_sessions").get().n, 1);
assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM friday_auth_sessions").all())
  .includes("test-token-not-persisted"));

assert.equal((await post("/auth/revoke-sessions", authCookie)).status, 204);
assert.equal((await get("/auth/status", authCookie)).status, 401);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM friday_auth_sessions").get().n, 0);

// Fixed-window limiter is atomic in the actual SQLite query implementation.
for (let i = 0; i < 4; i++) assert.equal((await get("/auth/start")).status, 302);
assert.equal((await get("/auth/start")).status, 429);
now += 10 * 60 * 1000;
assert.equal((await get("/auth/start")).status, 302);

sqlite.close();
process.stdout.write("PASS: real SQLite PKCE flow persistence, one-time replay, revocation, rate limit\n");
