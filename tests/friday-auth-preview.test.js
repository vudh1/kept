import test from "node:test";
import assert from "node:assert/strict";
import {
  DATABASE_NAME, PREVIEW_ORIGIN, WORKER_NAME,
  validatePreviewInput, resolveExistingD1, previewFiles, preparePreview,
} from "../scripts/prepare-friday-auth-preview.mjs";

const input = {
  previewApproval: "FRIDAY_FREE_PREVIEW", freePlanAttested: "true",
  repository: "vudh1/kept", repositoryOwner: "vudh1",
  actorId: "45385394", ownerId: "45385394",
  accountId: "a".repeat(32),
  d1Token: "d".repeat(28), workerToken: "w".repeat(28),
  githubClientId: "Ov23liFakeClient1234",
  githubClientSecret: "test-only-oauth-secret-not-real-123456",
};
const uuid = "12345678-1234-4123-8123-1234567890ab";

test("preview requires explicit typed consent, owner actor and existing Free plan attestation", () => {
  validatePreviewInput(input);
  const invalid = [
    { previewApproval: "" }, { freePlanAttested: "false" },
    { actorId: "1234" }, { ownerId: "1234" }, { repository: "other/kept" },
    { repositoryOwner: "someone-else" }, { accountId: "invalid" },
    { d1Token: "" }, { workerToken: "" },
    { githubClientSecret: "short" }, { githubClientId: "" },
  ];
  for (const changed of invalid) {
    assert.throws(() => validatePreviewInput({ ...input, ...changed }));
  }
});

test("preflight looks up exactly one existing D1 and never POSTs", async () => {
  const calls = [];
  const fetchFake = async (url, options) => {
    calls.push({ url: url.toString(), options });
    return { ok: true, json: async () => ({ success: true, result: [
      { name: DATABASE_NAME, uuid },
    ] }) };
  };
  assert.equal(await resolveExistingD1(input, fetchFake), uuid);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
  assert.match(calls[0].url, /name=kept-friday-reminders/);
});

test("missing, duplicate, invalid and permission-denied D1 fail closed", async () => {
  for (const result of [[], [{ name: DATABASE_NAME, uuid: "wrong" }],
    [{ name: DATABASE_NAME, uuid }, { name: DATABASE_NAME, uuid }]]) {
    await assert.rejects(resolveExistingD1(input, async () => ({
      ok: true, json: async () => ({ success: true, result }),
    })));
  }
  await assert.rejects(resolveExistingD1(input, async () => ({ ok: false, status: 403 })));
  await assert.rejects(resolveExistingD1(input, async () => ({
    ok: true, json: async () => ({ success: true, result: [{ name: DATABASE_NAME, uuid }],
      result_info: { total_pages: 2 } }),
  })));
});

test("generated preview binds ONLY the auth Worker and D1; secrets absent from config", async () => {
  const { config, secrets } = previewFiles(input, uuid, () => Buffer.alloc(48, 42));
  assert.match(config, new RegExp(`name = "${WORKER_NAME}"`));
  assert.ok(config.includes(`PUBLIC_BASE_URL = "${PREVIEW_ORIGIN}"`));
  assert.ok(config.includes(`database_id = "${uuid}"`));
  assert.equal(config.includes(input.githubClientSecret), false);
  assert.equal(config.includes(input.githubClientId), false);
  assert.deepEqual(secrets.ADMIN_GITHUB_IDS, "[45385394]");
  assert.equal(secrets.GITHUB_CLIENT_SECRET, input.githubClientSecret);
  assert.ok(secrets.RATE_LIMIT_KEY.length >= 32);
  assert.throws(() => previewFiles(input, "wrong"));

  const prepared = await preparePreview(input, { request: async () => ({
    ok: true, json: async () => ({ success: true, result: [{ name: DATABASE_NAME, uuid }] }),
  }), random: () => Buffer.alloc(48, 7) });
  assert.equal(prepared.config, config);
});
