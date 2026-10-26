// Proposed, isolated Kept FRIDAY administrator login. It is NOT the deployed
// kept-sync or kept-friday-admin Worker. No household data routes exist here.
const FLOW_SECONDS = 5 * 60;
const SESSION_SECONDS = 20 * 60;
const WINDOW_SECONDS = 10 * 60;
const STARTS_PER_WINDOW = 5;
const FLOW_COOKIE = "__Host-kept_friday_flow";
const SESSION_COOKIE = "__Host-kept_friday_session";

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

function json(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...HEADERS, "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}

function getCookie(header, name) {
  const matches = (header || "").split(";").map((v) => v.trim())
    .filter((v) => v.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-")
    .replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(cryptoApi) {
  return base64url(cryptoApi.getRandomValues(new Uint8Array(32)));
}

async function sha256(input, cryptoApi) {
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64url(new Uint8Array(digest));
}

async function keyedIpHash(ip, key, cryptoApi) {
  const hmacKey = await cryptoApi.subtle.importKey("raw", new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await cryptoApi.subtle.sign(
    "HMAC", hmacKey, new TextEncoder().encode(ip))));
}

export function parseAdminIds(value) {
  let ids;
  try { ids = JSON.parse(value); } catch { throw new Error("Invalid admin list"); }
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5 ||
      ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      new Set(ids).size !== ids.length) {
    throw new Error("Invalid admin list");
  }
  return ids;
}

export function validateConfig(env, url) {
  const ids = parseAdminIds(env?.ADMIN_GITHUB_IDS);
  const base = new URL(env?.PUBLIC_BASE_URL);
  if (base.protocol !== "https:" || base.username || base.password ||
      base.pathname !== "/" || base.search || base.hash ||
      base.origin !== url.origin ||
      !/^[A-Za-z0-9_]{8,128}$/.test(env?.GITHUB_CLIENT_ID || "") ||
      typeof env?.GITHUB_CLIENT_SECRET !== "string" || env.GITHUB_CLIENT_SECRET.length < 24 ||
      typeof env?.RATE_LIMIT_KEY !== "string" || env.RATE_LIMIT_KEY.length < 32 ||
      typeof env?.AUTH_DB?.prepare !== "function") {
    throw new Error("Missing secure configuration");
  }
  return { ids, origin: base.origin };
}

async function dbFirst(db, sql, ...args) {
  return db.prepare(sql).bind(...args).first();
}

async function dbRun(db, sql, ...args) {
  return db.prepare(sql).bind(...args).run();
}

async function readSession(request, db, ids, now, cryptoApi) {
  const token = getCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await dbFirst(db,
    "SELECT github_id FROM friday_auth_sessions WHERE token_hash = ? AND expires_at > ?",
    await sha256(token, cryptoApi), now);
  return row && ids.includes(row.github_id) ? { token, githubId: row.github_id } : null;
}

async function limitedStart(db, ipHash, now) {
  const windowStart = Math.floor(now / WINDOW_SECONDS) * WINDOW_SECONDS;
  const row = await dbFirst(db,
    `INSERT INTO friday_auth_limits (bucket_hash, window_start, attempts)
     VALUES (?, ?, 1) ON CONFLICT(bucket_hash) DO UPDATE SET
     attempts = CASE WHEN window_start = excluded.window_start THEN attempts + 1 ELSE 1 END,
     window_start = excluded.window_start RETURNING attempts`, ipHash, windowStart);
  return Number(row?.attempts) <= STARTS_PER_WINDOW;
}

async function githubUser(code, verifier, env, origin, requestFn) {
  const callback = `${origin}/auth/callback`;
  const response = await requestFn("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
      code, code_verifier: verifier, redirect_uri: callback,
    }),
    signal: AbortSignal.timeout(7000),
    redirect: "error",
  });
  if (!response.ok) return null;
  const token = await response.json();
  // Refuse unexpectedly privileged token scopes, including previously approved
  // OAuth scopes. An admin identity never needs repo or email access.
  if (token?.token_type?.toLowerCase() !== "bearer" ||
      typeof token?.access_token !== "string" ||
      token.access_token.length < 16 || token.scope !== "read:user") return null;
  const userResponse = await requestFn("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "kept-friday-auth",
    },
    signal: AbortSignal.timeout(7000),
    redirect: "error",
  });
  if (!userResponse.ok) return null;
  const user = await userResponse.json();
  return Number.isSafeInteger(user?.id) && user.id > 0 ? user.id : null;
}

export async function handleRequest(request, env, deps = {}) {
  const cryptoApi = deps.crypto || globalThis.crypto;
  const requestFn = deps.fetch || globalThis.fetch;
  const now = Math.floor((deps.now ? deps.now() : Date.now()) / 1000);
  const url = new URL(request.url);
  let config;
  try { config = validateConfig(env, url); }
  catch { return json({ error: "Authentication unavailable." }, 503); }
  const db = env.AUTH_DB;

  try {
    if (request.method === "GET" && url.pathname === "/auth/start") {
      const ipHash = await keyedIpHash(request.headers.get("CF-Connecting-IP") || "unknown",
        env.RATE_LIMIT_KEY, cryptoApi);
      if (!await limitedStart(db, ipHash, now)) {
        return json({ error: "Try again later." }, 429, { "Retry-After": "600" });
      }
      const state = randomToken(cryptoApi);
      const verifier = randomToken(cryptoApi);
      const stateHash = await sha256(state, cryptoApi);
      await dbRun(db,
        "INSERT INTO friday_auth_flows (state_hash, verifier, expires_at) VALUES (?, ?, ?)",
        stateHash, verifier, now + FLOW_SECONDS);
      const redirect = new URL("https://github.com/login/oauth/authorize");
      redirect.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      redirect.searchParams.set("redirect_uri", `${config.origin}/auth/callback`);
      redirect.searchParams.set("scope", "read:user");
      redirect.searchParams.set("state", state);
      redirect.searchParams.set("code_challenge_method", "S256");
      redirect.searchParams.set("code_challenge", await sha256(verifier, cryptoApi));
      redirect.searchParams.set("allow_signup", "false");
      return new Response(null, { status: 302, headers: {
        ...HEADERS, Location: redirect.href,
        "Set-Cookie": cookie(FLOW_COOKIE, state, FLOW_SECONDS),
      } });
    }

    if (request.method === "GET" && url.pathname === "/auth/callback") {
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const previous = getCookie(request.headers.get("Cookie"), FLOW_COOKIE);
      const expired = cookie(FLOW_COOKIE, "", 0);
      const deny = () => json({ error: "Sign-in rejected." }, 403, { "Set-Cookie": expired });
      // Duplicate callback keys and control characters make OAuth interpretation
      // ambiguous; reject before any D1 consume or provider exchange.
      if (url.searchParams.getAll("state").length !== 1 ||
          url.searchParams.getAll("code").length !== 1 ||
          !state || !code || !/^[A-Za-z0-9_-]{1,256}$/.test(code) ||
          !/^[A-Za-z0-9_-]{43}$/.test(state) || state !== previous) return deny();
      // Atomic consume; a valid state can never be exchanged twice.
      const flow = await dbFirst(db,
        "DELETE FROM friday_auth_flows WHERE state_hash = ? AND expires_at > ? RETURNING verifier",
        await sha256(state, cryptoApi), now);
      if (!flow || !/^[A-Za-z0-9_-]{43}$/.test(flow.verifier)) return deny();
      let id;
      try { id = await githubUser(code, flow.verifier, env, config.origin, requestFn); }
      catch { return deny(); }
      if (!config.ids.includes(id)) return deny();
      const token = randomToken(cryptoApi);
      await dbRun(db,
        "INSERT INTO friday_auth_sessions (token_hash, github_id, expires_at) VALUES (?, ?, ?)",
        await sha256(token, cryptoApi), id, now + SESSION_SECONDS);
      const headers = new Headers({ ...HEADERS, Location: "/auth/status" });
      headers.append("Set-Cookie", expired);
      headers.append("Set-Cookie", cookie(SESSION_COOKIE, token, SESSION_SECONDS));
      return new Response(null, { status: 303, headers });
    }

    if (request.method === "GET" && ["/auth/status", "/health"].includes(url.pathname)) {
      const session = await readSession(request, db, config.ids, now, cryptoApi);
      if (!session) return json({ error: "Authentication required." }, 401);
      return json({ ok: true, service: "kept-friday-auth", sharingEnabled: false });
    }

    if (request.method === "POST" && ["/auth/logout", "/auth/revoke-sessions"].includes(url.pathname)) {
      // No cross-origin state-changing requests; neither SameSite alone nor a
      // Vela remote PIN is sufficient authorization.
      if (request.headers.get("Origin") !== config.origin) return json({ error: "Forbidden." }, 403);
      const session = await readSession(request, db, config.ids, now, cryptoApi);
      if (!session) return json({ error: "Authentication required." }, 401);
      if (url.pathname === "/auth/revoke-sessions") {
        await dbRun(db, "DELETE FROM friday_auth_sessions WHERE github_id = ?", session.githubId);
      } else {
        await dbRun(db, "DELETE FROM friday_auth_sessions WHERE token_hash = ?",
          await sha256(session.token, cryptoApi));
      }
      return new Response(null, { status: 204,
        headers: { ...HEADERS, "Set-Cookie": cookie(SESSION_COOKIE, "", 0) } });
    }
    return json({ error: "Not found." }, 404);
  } catch {
    // On D1 quota exhaustion, timeouts or outages: never fall back to shared
    // tokens, local PINs, stale sessions, or a public household endpoint.
    return json({ error: "Authentication unavailable." }, 503);
  }
}

export default { fetch: handleRequest };
