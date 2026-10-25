import { PREVIEW_ORIGIN } from "./prepare-friday-auth-preview.mjs";

async function fetchPreview(path) {
  return fetch(PREVIEW_ORIGIN + path, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
}

try {
  const health = await fetchPreview("/health");
  if (health.status !== 401 || health.headers.get("access-control-allow-origin")) {
    throw new Error("Public health endpoint not fail-closed.");
  }
  const status = await fetchPreview("/auth/status");
  if (status.status !== 401) throw new Error("Unauthenticated status unexpectedly available.");
  const start = await fetchPreview("/auth/start");
  const redirect = new URL(start.headers.get("Location") || "");
  if (start.status !== 302 || redirect.origin !== "https://github.com" ||
      redirect.pathname !== "/login/oauth/authorize" ||
      redirect.searchParams.get("scope") !== "read:user" ||
      redirect.searchParams.get("code_challenge_method") !== "S256") {
    throw new Error("Preview did not produce the expected GitHub PKCE redirect.");
  }
  console.log("FRIDAY preview ready: protected endpoints deny anonymous access; GitHub PKCE redirect works.");
  console.log("No GitHub account login or household data access was performed.");
} catch {
  console.error("FRIDAY preview smoke failed. Worker may be deployed but unavailable; inspect without weakening auth.");
  process.exitCode = 1;
}
