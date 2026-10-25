import test from "node:test";
import assert from "node:assert/strict";
import { projectFridayReminders } from "../lib/friday-projection.js";

const id = "123e4567-e89b-42d3-a456-426614174000";
const id2 = "123e4567-e89b-42d3-a456-426614174001";
const updatedAt = "2026-10-25T10:00:00.000Z";
const state = {
  shopping: [{ id: "private-shopping", name: "Private shopping details" }],
  appliances: [{ id: "device-1", name: "Private appliance model", model: "Sensitive model" }],
  tasks: [{ id, applianceId: "device-1", title: "Replace filter", lastDone: "2026-10-01", intervalDays: 30,
    instructions: "Private household instructions", sourceUrl: "https://private.example", updatedAt }],
  history: [{ id: "private-history", title: "Private history" }]
};
const opts = { selectedTaskIds: [id], timeZone: "America/Los_Angeles", today: "2026-10-25" };

test("no explicit selection returns no household data", () => {
  assert.deepEqual(projectFridayReminders(state, { ...opts, selectedTaskIds: [] }), []);
  assert.deepEqual(projectFridayReminders(state, { ...opts, selectedTaskIds: undefined }), []);
  assert.deepEqual(projectFridayReminders(state, { ...opts, selectedTaskIds: "all" }), []);
});

test("one opted-in task yields only the v1 minimum; all private fields are excluded", () => {
  const events = projectFridayReminders(state, opts);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    schemaVersion: 1, id: `kept:task:${id}`, source: "kept",
    revision: `${updatedAt}|2026-10-31`, category: "life", title: "Replace filter",
    status: "confirmed", visibility: "authorized-profile",
    time: { kind: "all-day", startDate: "2026-10-31", endDateExclusive: "2026-11-01", timeZone: "America/Los_Angeles" },
    sourceUpdatedAt: updatedAt
  });
  for (const privateText of ["Private shopping", "Private appliance", "Sensitive model", "Private household", "private.example", "Private history"])
    assert.equal(JSON.stringify(events).includes(privateText), false);
});

test("projection excludes deleted tasks, missing appliances, invalid IDs, unsafe titles and invalid dates", () => {
  const overrides = [
    { deleted: true }, { applianceId: "missing" }, { id: "kitchen-address" },
    { title: "https://example.com/private" }, { title: "owner@example.com" },
    { title: "Call 123-456-7890" }, { updatedAt: "yesterday" },
    { lastDone: "2026-02-30" }, { intervalDays: 0 }, { intervalDays: 1.5 }
  ];
  for (const bad of overrides) {
    const candidate = { ...state.tasks[0], ...bad };
    const data = { ...state, tasks: [candidate] };
    assert.deepEqual(projectFridayReminders(data, { ...opts, selectedTaskIds: [candidate.id] }), [], JSON.stringify(bad));
  }
  assert.deepEqual(projectFridayReminders({ ...state, appliances: [{ id: "device-1", deleted: true }] }, opts), []);
});

test("respects bounded overdue/future windows, dedupes selections, sorts and caps", () => {
  const second = { ...state.tasks[0], id: id2, title: "Inspect vent", lastDone: "2026-10-21", intervalDays: 1 };
  const data = { ...state, tasks: [state.tasks[0], second] };
  assert.deepEqual(projectFridayReminders(data, { ...opts, selectedTaskIds: [id, id, id2], maxRecords: 1 }).map(x => x.id), [`kept:task:${id2}`]);
  assert.deepEqual(projectFridayReminders(data, { ...opts, selectedTaskIds: [id2], pastDays: 2 }), []);
  assert.deepEqual(projectFridayReminders(data, { ...opts, futureDays: 2 }).map(x => x.id), []);
});

test("calendar day and revision semantics remain stable across DST", () => {
  const data = { ...state, tasks: [{ ...state.tasks[0], lastDone: "2026-03-07", intervalDays: 2 }] };
  const events = projectFridayReminders(data, { ...opts, today: "2026-03-08" });
  assert.equal(events[0].time.startDate, "2026-03-09");
  assert.equal(events[0].time.endDateExclusive, "2026-03-10");
  assert.deepEqual(projectFridayReminders(data, { ...opts, today: "2026-03-08" }), events);
  const changed = { ...data, tasks: [{ ...data.tasks[0], updatedAt: "2026-10-25T10:01:00.000Z" }] };
  assert.notEqual(projectFridayReminders(changed, { ...opts, today: "2026-03-08" })[0].revision, events[0].revision);
});

test("rejects invalid time zone, calendar dates and unbounded queries", () => {
  assert.throws(() => projectFridayReminders(state, { ...opts, timeZone: "Invalid/Zone" }), TypeError);
  assert.throws(() => projectFridayReminders(state, { ...opts, today: "2026-02-30" }), TypeError);
  assert.throws(() => projectFridayReminders(state, { ...opts, maxRecords: 5000 }), RangeError);
});
