/** Ciphertext-only remote sync, optimistic commits, and conflict reconciliation. */
import { encryptState, decryptState } from "./crypto.js";
import { mergeState, validateState } from "./store.js";
async function api(baseUrl, token, path, options = {}) {
  const url = baseUrl.replace(/\/$/, "") + path;
  const response = await fetch(url, {
    ...options,
    headers: { "X-Kept-Key": token, ...(options.body ? { "Content-Type": "application/json" } : {}) },
    cache: "no-store"
  });
  let result = {};
  try { result = await response.json(); } catch { /* preserve error status */ }
  if (!response.ok) {
    const e = new Error(result.error || `Sync request failed (${response.status}).`);
    e.status = response.status;
    throw e;
  }
  return result;
}
export async function syncOnce(localState, config) {
  const { baseUrl, token, passphrase } = config;
  if (!baseUrl || !token || !passphrase) throw new Error("Add backend URL, access key, and household passphrase in Settings.");
  let current = validateState(localState);
  for (let attempt = 0; attempt < 5; attempt++) {
    const remote = await api(baseUrl, token, "/api/state");
    if (remote.envelope) current = mergeState(current, await decryptState(remote.envelope, passphrase));
    const envelope = await encryptState(current, passphrase);
    try {
      await api(baseUrl, token, "/api/state", { method: "PUT", body: JSON.stringify({ envelope, sha: remote.sha || null }) });
      return current;
    } catch (e) { if (e.status !== 409 || attempt === 4) throw e; }
  }
  throw new Error("Sync conflict. Please retry.");
}
export async function researchAppliance(config, info) {
  return api(config.baseUrl, config.token, "/api/research", { method: "POST", body: JSON.stringify(info) });
}
export async function askAssistant(config, message, appliance) {
  return api(config.baseUrl, config.token, "/api/assist", { method: "POST", body: JSON.stringify({ message, appliance }) });
}
