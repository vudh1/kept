import test from "node:test";
import assert from "node:assert/strict";
import { DATABASE_NAME, ensureFridayDatabase } from "../scripts/provision-friday-d1.mjs";

const accountId = "1".repeat(32);
const apiToken = "test-value-long-enough-for-validation";
const databaseId = "123e4567-e89b-42d3-a456-426614174000";
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" }
});

test("provision D1 is idempotent: an existing exact-name database never causes POST", async () => {
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url, options });
    return json({ success: true, result: [{ name: DATABASE_NAME, uuid: databaseId }] });
  };
  assert.deepEqual(await ensureFridayDatabase({ accountId, apiToken, request }),
    { created: false, databaseId, name: DATABASE_NAME });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\?name=kept-friday-reminders$/);
  assert.equal(requests[0].options.method, "GET");
});

test("provision creates exactly one empty, read-replication-disabled database", async () => {
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url, options });
    return options.method === "GET"
      ? json({ success: true, result: [] })
      : json({ success: true, result: { name: DATABASE_NAME, uuid: databaseId } });
  };
  assert.deepEqual(await ensureFridayDatabase({ accountId, apiToken, request }),
    { created: true, databaseId, name: DATABASE_NAME });
  assert.deepEqual(requests.map(r => r.options.method), ["GET", "POST"]);
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    name: DATABASE_NAME,
    read_replication: { mode: "disabled" }
  });
  assert.ok(!requests[1].options.body.includes("shopping"));
  assert.ok(!requests[1].options.body.includes("instructions"));
});

test("missing authorization, API 403, malformed result and invalid IDs fail closed", async () => {
  let calls = 0;
  const request = async () => { calls += 1; return json({ success: false }, 403); };
  await assert.rejects(ensureFridayDatabase({ accountId, apiToken: "", request }), /token/);
  await assert.rejects(ensureFridayDatabase({ accountId: "wrong", apiToken, request }), /account ID/);
  assert.equal(calls, 0);
  await assert.rejects(ensureFridayDatabase({ accountId, apiToken, request }), /D1 Read\/Write/);
  assert.equal(calls, 1);
  await assert.rejects(ensureFridayDatabase({ accountId, apiToken, request: async () => json({ success: true, result: {} }) }), /invalid database list/);
  await assert.rejects(ensureFridayDatabase({ accountId, apiToken, request: async () => json({
    success: true, result: [{ name: DATABASE_NAME, uuid: "invalid" }]
  }) }), /database ID is invalid/);
});
