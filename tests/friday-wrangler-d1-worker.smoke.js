// LOCAL WRANGLER ONLY. This disposable entrypoint exercises the real D1 binding
// with stubbed GitHub responses and fake secrets. Never deploy this as a Worker.
import { handleRequest } from "../worker/friday-auth/index.js";

const ORIGIN = "https://localhost:8787";
const CLOCK = Date.UTC(2026, 9, 25, 12, 0, 0);
const TEST_ID = 12345;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/__local_smoke") {
      return new Response("Not found", { status: 404 });
    }
    const fakeEnv = {
      ...env,
      PUBLIC_BASE_URL: ORIGIN,
      ADMIN_GITHUB_IDS: `[${TEST_ID}]`,
      GITHUB_CLIENT_ID: "Ov23liLocalFakeClientID",
      GITHUB_CLIENT_SECRET: "local-fake-secret-not-usable-outside-tests",
      RATE_LIMIT_KEY: "local-fake-rate-key-not-usable-outside-tests",
    };
    let activeId = TEST_ID;
    let now = CLOCK;
    const deps = {
      now: () => now,
      fetch: async (url, options) => {
        expect(Boolean(options?.signal), "GitHub request missing timeout signal");
        if (url.includes("oauth/access_token")) {
          return Response.json({
            token_type: "bearer",
            access_token: "local-fake-token-with-enough-length",
            scope: "read:user",
          });
        }
        if (url === "https://api.github.com/user") return Response.json({ id: activeId });
        throw new Error("Unexpected external request");
      },
    };
    const call = (path, { method = "GET", cookie = "", ip = "198.51.100.51", origin } = {}) => {
      const headers = new Headers({ Cookie: cookie, "CF-Connecting-IP": ip });
      if (origin) headers.set("Origin", origin);
      return handleRequest(new Request(ORIGIN + path, { method, headers }), fakeEnv, deps);
    };
    const started = await call("/auth/start");
    expect(started.status === 302, "OAuth start must redirect");
    const redirect = new URL(started.headers.get("Location"));
    expect(redirect.host === "github.com", "OAuth redirect must point at GitHub");
    expect(redirect.searchParams.get("scope") === "read:user", "Unexpected OAuth scopes");
    expect(redirect.searchParams.get("code_challenge_method") === "S256", "PKCE S256 missing");
    const state = redirect.searchParams.get("state");
    const flowCookie = started.headers.get("Set-Cookie").split(";")[0];
    const callback = `/auth/callback?state=${encodeURIComponent(state)}&code=local-test-once`;
    const signedIn = await call(callback, { cookie: flowCookie });
    expect(signedIn.status === 303, "Allowed account must get a session");
    const setCookies = signedIn.headers.getSetCookie?.() ||
      [signedIn.headers.get("Set-Cookie") || ""];
    const sessionCookie = setCookies.join("\n")
      .match(/__Host-kept_friday_session=[A-Za-z0-9_-]{43}/)?.[0];
    expect(Boolean(sessionCookie), "Session cookie missing");
    expect((await call("/auth/status", { cookie: sessionCookie })).status === 200,
      "Session should authorize");
    expect((await call(callback, { cookie: flowCookie })).status === 403,
      "OAuth flow must be single use");

    const forbiddenPost = await call("/auth/revoke-sessions", {
      method: "POST", cookie: sessionCookie, origin: "https://evil.example",
    });
    expect(forbiddenPost.status === 403, "Cross-origin revoke must be denied");
    const revoked = await call("/auth/revoke-sessions", {
      method: "POST", cookie: sessionCookie, origin: ORIGIN,
    });
    expect(revoked.status === 204, "Revoke all sessions must succeed");
    expect((await call("/auth/status", { cookie: sessionCookie })).status === 401,
      "Revoked session must fail immediately");

    activeId = TEST_ID + 1;
    const deniedStart = await call("/auth/start", { ip: "198.51.100.52" });
    const deniedRedirect = new URL(deniedStart.headers.get("Location"));
    const deniedState = deniedRedirect.searchParams.get("state");
    const deniedCookie = deniedStart.headers.get("Set-Cookie").split(";")[0];
    expect((await call(`/auth/callback?state=${deniedState}&code=wrong-user`, {
      cookie: deniedCookie,
    })).status === 403, "Unapproved GitHub ID must be denied");

    for (let i = 0; i < 4; i++) {
      expect((await call("/auth/start")).status === 302, "Under-limit start blocked");
    }
    expect((await call("/auth/start")).status === 429, "Rate limit not enforced");
    now += 10 * 60 * 1000;
    expect((await call("/auth/start")).status === 302, "Rate limit did not reset");

    return Response.json({
      ok: true,
      tests: ["PKCE and redirect", "single use state", "session and revocation",
        "CSRF", "exact GitHub ID", "rate-limit D1 UPSERT and reset"],
      realGithubCalled: false,
      realCloudflareCalled: false,
    });
  },
};
