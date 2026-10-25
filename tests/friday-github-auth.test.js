import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest, parseAdminIds } from "../worker/friday-auth/index.js";

const ORIGIN = "https://auth.example.workers.dev";
const ADMIN_ID = 98765;
const envBase = {
  PUBLIC_BASE_URL: ORIGIN,
  ADMIN_GITHUB_IDS: `[${ADMIN_ID}]`,
  GITHUB_CLIENT_ID: "Ov23liExampleClientId",
  GITHUB_CLIENT_SECRET: "github-secret-placeholder-over-24-characters",
  RATE_LIMIT_KEY: "rate-limit-key-placeholder-more-than-32-characters",
};
const epoch = Date.UTC(2026, 9, 25, 12, 0, 0);

class FakeD1 {
  constructor() {
    this.flows = new Map();
    this.sessions = new Map();
    this.limits = new Map();
    this.failed = false;
  }
  prepare(sql) {
    if (this.failed) throw new Error("private D1 service details");
    return { bind: (...args) => ({
      first: async () => this.first(sql, args),
      run: async () => this.run(sql, args),
    }) };
  }
  first(sql, args) {
    if (sql.startsWith("INSERT INTO friday_auth_limits")) {
      const [id, window] = args;
      const last = this.limits.get(id);
      const count = last && last.window === window ? last.count + 1 : 1;
      this.limits.set(id, { window, count });
      return { attempts: count };
    }
    if (sql.startsWith("DELETE FROM friday_auth_flows")) {
      const [hash, now] = args;
      const flow = this.flows.get(hash);
      if (!flow || flow.expiresAt <= now) return null;
      this.flows.delete(hash);
      return { verifier: flow.verifier };
    }
    if (sql.startsWith("SELECT github_id FROM friday_auth_sessions")) {
      const [hash, now] = args;
      const session = this.sessions.get(hash);
      return session?.expiresAt > now ? { github_id: session.id } : null;
    }
    throw Error(`Unknown SQL: ${sql.slice(0,90)}`);
  }
  run(sql, args) {
    if (sql.startsWith("INSERT INTO friday_auth_flows")) {
      const [hash, verifier, expiresAt] = args;
      this.flows.set(hash, { verifier, expiresAt });
    } else if (sql.startsWith("INSERT INTO friday_auth_sessions")) {
      const [hash, id, expiresAt] = args;
      this.sessions.set(hash, { id, expiresAt });
    } else if (sql.startsWith("DELETE FROM friday_auth_sessions WHERE github_id")) {
      for (const [hash, session] of this.sessions) if (session.id === args[0]) this.sessions.delete(hash);
    } else if (sql.startsWith("DELETE FROM friday_auth_sessions WHERE token_hash")) {
      this.sessions.delete(args[0]);
    } else throw Error(`Unknown SQL: ${sql.slice(0,90)}`);
    return { success: true };
  }
}

function setup() {
  const db = new FakeD1();
  const env = { ...envBase, AUTH_DB: db };
  const calls = [];
  let githubId = ADMIN_ID;
  let scopes = "read:user";
  let upstreamOk = true;
  const deps = {
    now: () => epoch,
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      if (!upstreamOk) return { ok: false };
      return { ok: true, json: async () => url.includes("oauth/access_token")
        ? { token_type: "bearer", scope: scopes, access_token: "github-test-access-token" }
        : { id: githubId } };
    },
  };
  const request = (path, options = {}) => new Request(`${ORIGIN}${path}`, options);
  const call = (path, options = {}) => handleRequest(request(path, options), env, deps);
  return {
    db, env, deps, calls, call, request,
    setGithubId: (id) => { githubId = id; },
    setScopes: (value) => { scopes = value; },
    setUpstreamOk: (value) => { upstreamOk = value; },
  };
}

async function begin(ctx) {
  const response = await ctx.call("/auth/start", { headers: { "CF-Connecting-IP": "198.51.100.10" } });
  assert.equal(response.status, 302);
  const redirect = new URL(response.headers.get("Location"));
  const state = redirect.searchParams.get("state");
  const cookie = response.headers.get("Set-Cookie").split(";")[0];
  assert.match(cookie, /^__Host-kept_friday_flow=/);
  return { redirect, state, cookie };
}

async function login(ctx) {
  const started = await begin(ctx);
  const response = await ctx.call(`/auth/callback?state=${started.state}&code=once`, {
    headers: { Cookie: started.cookie },
  });
  return { ...started, response, sessionCookie: response.headers.get("Set-Cookie")
    ?.split(/,\s*(?=__Host-)/).find((s) => s.startsWith("__Host-kept_friday_session="))?.split(";")[0] };
}

test("allowlisted numeric GitHub IDs are exact; configuration fails closed", async () => {
  assert.deepEqual(parseAdminIds("[98765,2]"), [98765, 2]);
  for (const bad of ["", "{}", "[]", '["98765"]', "[0]", "[-1]", "[98765,98765]", "[1.2]", "[1e20]", "[1,2,3,4,5,6]"]) {
    assert.throws(() => parseAdminIds(bad));
  }
  const ctx = setup();
  for (const changed of [{ AUTH_DB: null }, { PUBLIC_BASE_URL: "http://auth.example.workers.dev" },
    { PUBLIC_BASE_URL: "https://evil.example" }, { GITHUB_CLIENT_SECRET: "short" },
    { ADMIN_GITHUB_IDS: "[]" }]) {
    assert.equal((await handleRequest(ctx.request("/auth/start"), { ...ctx.env, ...changed }, ctx.deps)).status, 503);
  }
  assert.equal(ctx.db.flows.size, 0);
});

test("authorization redirects only to GitHub and uses PKCE S256, narrow scope and secure cookies", async () => {
  const ctx = setup();
  const { redirect, state, cookie } = await begin(ctx);
  assert.equal(redirect.origin, "https://github.com");
  assert.equal(redirect.pathname, "/login/oauth/authorize");
  assert.equal(redirect.searchParams.get("scope"), "read:user");
  assert.equal(redirect.searchParams.get("redirect_uri"), `${ORIGIN}/auth/callback`);
  assert.equal(redirect.searchParams.get("code_challenge_method"), "S256");
  assert.match(redirect.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  const response = await ctx.call("/health");
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  const start = await ctx.call("/auth/start", { headers: { "CF-Connecting-IP": "198.51.100.11" } });
  assert.match(start.headers.get("Set-Cookie"), /Secure; HttpOnly; SameSite=Lax/);
  assert.doesNotMatch(cookie, /github-secret|98765/);
});

test("callback exchanges code once, validates identity, drops token and revokes session", async () => {
  const ctx = setup();
  const { response, state, cookie, sessionCookie } = await login(ctx);
  assert.equal(response.status, 303);
  assert.ok(sessionCookie);
  assert.equal(ctx.db.flows.size, 0);
  assert.equal(ctx.db.sessions.size, 1);
  assert.equal(ctx.calls.length, 2);
  const exchange = JSON.parse(ctx.calls[0].opts.body);
  assert.equal(exchange.redirect_uri, `${ORIGIN}/auth/callback`);
  assert.match(exchange.code_verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(ctx.calls[1].opts.headers.Authorization.startsWith("Bearer "));
  assert.doesNotMatch(JSON.stringify([...ctx.db.sessions]), /github-test-access-token|github-secret/);

  assert.equal((await ctx.call("/health", { headers: { Cookie: sessionCookie } })).status, 200);
  assert.equal((await ctx.call(`/auth/callback?state=${state}&code=once`, { headers: { Cookie: cookie } })).status, 403);
  const noOrigin = await ctx.call("/auth/logout", { method: "POST", headers: { Cookie: sessionCookie } });
  assert.equal(noOrigin.status, 403);
  const loggedOut = await ctx.call("/auth/logout", { method: "POST",
    headers: { Cookie: sessionCookie, Origin: ORIGIN } });
  assert.equal(loggedOut.status, 204);
  assert.equal(ctx.db.sessions.size, 0);
  assert.equal((await ctx.call("/health", { headers: { Cookie: sessionCookie } })).status, 401);
});

test("state tampering, missing cookie, expired state and callback replay are rejected", async () => {
  const ctx = setup();
  const { cookie, state } = await begin(ctx);
  assert.equal((await ctx.call(`/auth/callback?state=${state}&code=x`)).status, 403);
  assert.equal((await ctx.call(`/auth/callback?state=${"x".repeat(43)}&code=x`, { headers: { Cookie: cookie } })).status, 403);
  assert.equal(ctx.calls.length, 0);
  ctx.deps.now = () => epoch + 5 * 60 * 1000;
  assert.equal((await ctx.call(`/auth/callback?state=${state}&code=x`, { headers: { Cookie: cookie } })).status, 403);
  assert.equal(ctx.calls.length, 0);
});

test("wrong GitHub ID, overbroad token scope and upstream failures all deny login", async () => {
  for (const failure of ["wrong-id", "scope", "upstream"]) {
    const ctx = setup();
    if (failure === "wrong-id") ctx.setGithubId(123);
    if (failure === "scope") ctx.setScopes("repo,read:user");
    if (failure === "upstream") ctx.setUpstreamOk(false);
    const { response } = await login(ctx);
    assert.equal(response.status, 403);
    assert.equal(ctx.db.sessions.size, 0);
  }
});

test("session expires in 20 minutes, allowlist removal and revoke-all deny access", async () => {
  const ctx = setup();
  const { sessionCookie } = await login(ctx);
  ctx.env.ADMIN_GITHUB_IDS = "[999]";
  assert.equal((await ctx.call("/health", { headers: { Cookie: sessionCookie } })).status, 401);
  ctx.env.ADMIN_GITHUB_IDS = `[${ADMIN_ID}]`;
  const revoked = await ctx.call("/auth/revoke-sessions", { method: "POST",
    headers: { Cookie: sessionCookie, Origin: ORIGIN } });
  assert.equal(revoked.status, 204);
  assert.equal(ctx.db.sessions.size, 0);
  const { sessionCookie: nextCookie } = await login(ctx);
  ctx.deps.now = () => epoch + 20 * 60 * 1000;
  assert.equal((await ctx.call("/health", { headers: { Cookie: nextCookie } })).status, 401);
});

test("rate limiter denies excess start attempts; DB outage never opens any route", async () => {
  const ctx = setup();
  for (let i = 0; i < 5; i++) assert.equal((await begin(ctx)).redirect.origin, "https://github.com");
  const limited = await ctx.call("/auth/start", { headers: { "CF-Connecting-IP": "198.51.100.10" } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "600");
  ctx.db.failed = true;
  const failed = await ctx.call("/auth/start");
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /private|github-secret/);
  assert.equal((await ctx.call("/health")).status, 401);
  assert.equal((await ctx.call("/v1/friday/reminders")).status, 404);
});
