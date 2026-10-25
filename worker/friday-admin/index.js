const RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: RESPONSE_HEADERS });
}

export function parseAdminEmails(secret) {
  let addresses;
  try {
    addresses = JSON.parse(secret);
  } catch {
    throw new Error("Administrator allowlist must be a JSON array.");
  }
  if (!Array.isArray(addresses) || addresses.length < 1 || addresses.length > 10) {
    throw new Error("Administrator allowlist must contain 1–10 exact emails.");
  }
  const emails = addresses.map((value) => {
    if (typeof value !== "string") throw new Error("Administrator email is invalid.");
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
      throw new Error("Administrator email is invalid.");
    }
    return email;
  });
  if (new Set(emails).size !== emails.length) {
    throw new Error("Administrator allowlist contains duplicates.");
  }
  return emails;
}

export async function handleRequest(request, env, ctx) {
  let emails;
  try {
    emails = parseAdminEmails(env?.ADMIN_EMAILS);
  } catch {
    return json({ error: "Access unavailable." }, 503);
  }

  // ctx.access is supplied by Cloudflare Access only after a successful Access
  // authentication. This check keeps the Worker closed before Access is set up.
  if (typeof ctx?.access?.getIdentity !== "function") {
    return json({ error: "Access required." }, 403);
  }
  let identity;
  try {
    identity = await ctx.access.getIdentity();
  } catch {
    return json({ error: "Access required." }, 403);
  }
  if (typeof identity?.email !== "string" ||
      !emails.includes(identity.email.trim().toLowerCase())) {
    return json({ error: "Access required." }, 403);
  }

  const { pathname } = new URL(request.url);
  if (pathname === "/health" && request.method === "GET") {
    return json({ ok: true, service: "kept-friday-admin", sharingEnabled: false });
  }
  return json({ error: "Not found." }, 404);
}

export default { fetch: handleRequest };
