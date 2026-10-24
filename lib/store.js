/** Local-first household state and per-record conflict merge. No credentials here. */
export const STORAGE_KEY = "kept.household.v1";
export const SETTINGS_KEY = "kept.settings.v1";
export const blankState = () => ({ version: 1, shopping: [], appliances: [], tasks: [], history: [] });
export function validateState(input) {
  const data = blankState();
  for (const key of ["shopping", "appliances", "tasks", "history"]) {
    data[key] = Array.isArray(input?.[key]) ? input[key].filter(x => x && typeof x.id === "string").slice(0, 10000) : [];
  }
  return data;
}
export function mergeState(local, remote) {
  const a = validateState(local), b = validateState(remote);
  const result = blankState();
  for (const key of ["shopping", "appliances", "tasks", "history"]) {
    const merged = new Map();
    for (const item of [...a[key], ...b[key]]) {
      const prev = merged.get(item.id);
      const stamp = `${item.updatedAt || ""}/${item.updatedBy || ""}`;
      const previousStamp = `${prev?.updatedAt || ""}/${prev?.updatedBy || ""}`;
      if (!prev || stamp >= previousStamp) merged.set(item.id, item);
    }
    result[key] = [...merged.values()].sort((x,y) => x.id.localeCompare(y.id));
  }
  return result;
}
export function readLocal() {
  try { return validateState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { return blankState(); }
}
export function writeLocal(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(validateState(data))); }
export function touch(item, deviceId) {
  return { ...item, updatedAt: new Date().toISOString(), updatedBy: deviceId };
}
export function uid() { return crypto.randomUUID(); }
