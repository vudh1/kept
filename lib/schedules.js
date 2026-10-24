/** Pure due-date logic. Calendar-day arithmetic avoids DST clock drift. */
export function todayLocal(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
export function addDays(yyyyMmDd, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd || "")) return null;
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + Number(days)));
  if (!Number.isFinite(date.getTime()) || date.getUTCMonth() === undefined) return null;
  return date.toISOString().slice(0, 10);
}
export function daysBetween(dateA, dateB) {
  const a = Date.parse(`${dateA}T12:00:00Z`);
  const b = Date.parse(`${dateB}T12:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : NaN;
}
export function dueDate(task) {
  if (!task?.lastDone || !Number.isInteger(Number(task.intervalDays)) || Number(task.intervalDays) < 1) return null;
  return addDays(task.lastDone, task.intervalDays);
}
export function status(task, today = todayLocal()) {
  const date = dueDate(task);
  if (!date) return { kind: "unscheduled", date: null, label: "Needs a date" };
  const delta = daysBetween(today, date);
  if (delta < 0) return { kind: "overdue", date, label: `${Math.abs(delta)}d overdue` };
  if (delta === 0) return { kind: "due", date, label: "Due today" };
  if (delta <= 14) return { kind: "soon", date, label: `In ${delta}d` };
  return { kind: "good", date, label: `In ${delta}d` };
}
export function upcomingTasks(data, today = todayLocal()) {
  const active = new Set((data.appliances || []).filter(x => !x.deleted).map(x => x.id));
  return (data.tasks || []).filter(x => !x.deleted && active.has(x.applianceId))
    .map(task => ({ ...task, due: status(task, today) }))
    .sort((a,b) => (a.due.date || "0000").localeCompare(b.due.date || "0000"));
}
export function formatDate(d) {
  if (!d) return "Not set";
  const date = new Date(`${d}T12:00:00`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : d;
}
export function calendarFile(tasks, appliances) {
  const names = new Map(appliances.map(a => [a.id, a.name]));
  const escape = x => String(x ?? "").replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll(/\r?\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kept//Household Maintenance//EN", "CALSCALE:GREGORIAN"];
  for (const t of tasks) {
    const when = dueDate(t);
    if (!when) continue;
    lines.push("BEGIN:VEVENT", `UID:${t.id}@kept.local`, `DTSTART;VALUE=DATE:${when.replaceAll("-", "")}`, `SUMMARY:${escape(`${names.get(t.applianceId) || "Home"}: ${t.title}`)}`, `DESCRIPTION:${escape(t.instructions || "Kept maintenance reminder")}`, "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Maintenance due", "TRIGGER:-P1D", "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
