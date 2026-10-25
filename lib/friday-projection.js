/**
 * FRIDAY's opt-in, device-local Kept reminder projection (v1 draft).
 *
 * The caller must supply task IDs the user explicitly selected. This module
 * does not read browser storage, use the encrypted sync token, make network
 * requests, or grant another device access. It is not a sharing endpoint.
 */
import { addDays, daysBetween, dueDate } from "./schedules.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PII_HINT = /https?:\/\/|www\.|@|[<>]|(?:\+?\d[\s.()-]*){9,}/i;

function calendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function instant(value) {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function safeTitle(value) {
  if (typeof value !== "string") return null;
  const title = value.replace(/\s+/g, " ").trim();
  if (!title || title.length > 80 || /[\x00-\x1f\x7f]/.test(title) || PII_HINT.test(title)) return null;
  return title;
}

/**
 * Return only explicitly selected, due/overdue task summaries. The originating
 * Kept device decides consent before calling; transport authorization, grant
 * expiration, revocation and server retention MUST be implemented separately.
 */
export function projectFridayReminders(data, {
  selectedTaskIds = [],
  timeZone,
  today,
  pastDays = 30,
  futureDays = 90,
  maxRecords = 20
} = {}) {
  if (!calendarDate(today)) throw new TypeError("A valid local calendar date is required.");
  if (typeof timeZone !== "string" || timeZone.length > 80) throw new TypeError("An IANA time zone is required.");
  try { new Intl.DateTimeFormat("en-US", { timeZone }); }
  catch { throw new TypeError("An IANA time zone is required."); }
  if (!Number.isInteger(pastDays) || pastDays < 0 || pastDays > 365 ||
      !Number.isInteger(futureDays) || futureDays < 0 || futureDays > 365 ||
      !Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 50) {
    throw new RangeError("Projection window or record limit is invalid.");
  }
  if (!Array.isArray(selectedTaskIds) && !(selectedTaskIds instanceof Set)) return [];
  const selected = new Set(selectedTaskIds);
  if (!selected.size) return [];
  const activeAppliances = new Set((data?.appliances || []).filter(a => !a.deleted).map(a => a.id));
  const projections = [];
  for (const task of data?.tasks || []) {
    if (!task || task.deleted || !UUID.test(task.id || "") || !selected.has(task.id) ||
        !activeAppliances.has(task.applianceId) || !instant(task.updatedAt)) continue;
    const title = safeTitle(task.title);
    if (!title || !calendarDate(task.lastDone) || !Number.isInteger(task.intervalDays) ||
        task.intervalDays < 1 || task.intervalDays > 3650) continue;
    const when = dueDate(task);
    if (!calendarDate(when)) continue;
    const delta = daysBetween(today, when);
    if (!Number.isFinite(delta) || delta < -pastDays || delta > futureDays) continue;
    projections.push({
      schemaVersion: 1,
      id: `kept:task:${task.id}`,
      source: "kept",
      revision: `${task.updatedAt}|${when}`,
      category: "life",
      title,
      status: "confirmed",
      visibility: "authorized-profile",
      time: {
        kind: "all-day",
        startDate: when,
        endDateExclusive: addDays(when, 1),
        timeZone
      },
      sourceUpdatedAt: task.updatedAt
    });
  }
  projections.sort((a, b) => a.time.startDate.localeCompare(b.time.startDate) || a.id.localeCompare(b.id));
  return projections.slice(0, maxRecords);
}
