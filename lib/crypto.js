/** Browser-only AES-256-GCM encryption. Passphrase never leaves the client. */
const enc = new TextEncoder();
const dec = new TextDecoder();
function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  const raw = atob(s);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function derive(passphrase, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptState(data, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 12) throw new Error("Household passphrase must be at least 12 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(data)));
  return { v: 1, algorithm: "PBKDF2-SHA256/AES-256-GCM", salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) };
}
export async function decryptState(envelope, passphrase) {
  if (envelope?.v !== 1 || !envelope?.salt || !envelope?.iv || !envelope?.ciphertext) throw new Error("Unsupported encrypted state format.");
  try {
    const key = await derive(passphrase, unb64(envelope.salt));
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(envelope.iv) }, key, unb64(envelope.ciphertext));
    return JSON.parse(dec.decode(bytes));
  } catch { throw new Error("Cannot unlock household data. Check your passphrase."); }
}
