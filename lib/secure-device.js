/** Trusted-device session and ciphertext-only local data storage (IndexedDB).
 * CryptoKey is stored as non-extractable; no household plaintext is persisted.
 */
import { blankState, validateState } from "./store.js";
import { encryptWithKey, decryptWithKey } from "./crypto.js";
const DB_NAME="kept-secure-v1", STORE="vault";
function openDB() {
  return new Promise((resolve,reject)=>{
    if(!("indexedDB" in globalThis))return reject(new Error("Private device storage is unavailable."));
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error("Cannot open secure storage."));
  });
}
async function operation(mode, action) {
  const db=await openDB();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);
      let result;
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(tx.error||new Error("Secure storage error."));
      tx.onabort=()=>reject(tx.error||new Error("Secure storage transaction aborted."));
      action(store,value=>{result=value;});
    });
  } finally {db.close();}
}
const get=key=>operation("readonly",(s,done)=>{const r=s.get(key);r.onsuccess=()=>done(r.result);});
const put=(key,val)=>operation("readwrite",(s)=>{s.put(val,key);});
export async function deviceSession() {return await get("device")||null;}
export async function rememberDevice(token,hexKey) {
  if(!/^[a-f0-9]{64}$/i.test(token||"")||!/^[a-f0-9]{64}$/i.test(hexKey||""))throw new Error("Invalid device credential.");
  const bytes=Uint8Array.from(hexKey.match(/../g),h=>parseInt(h,16));
  const key=await crypto.subtle.importKey("raw",bytes,{name:"AES-GCM"},false,["encrypt","decrypt"]);
  await put("device",{token,key});
  return {token,key};
}
export async function updateToken(token) {
  const old=await deviceSession();
  if(!old?.key||!/^[a-f0-9]{64}$/i.test(token||""))throw new Error("Invalid device session.");
  await put("device",{token,key:old.key});
  return {token,key:old.key};
}
export async function readProtected() {
  const session=await deviceSession();
  const envelope=await get("state");
  if(!envelope||!session?.key)return blankState();
  return validateState(await decryptWithKey(envelope,session.key));
}
export async function writeProtected(state,session) {
  if(!session?.key)throw new Error("Device not connected.");
  const ciphertext=await encryptWithKey(validateState(state),session.key);
  await put("state",ciphertext);
}
export async function forgetDevice() {
  await operation("readwrite",(s)=>{s.delete("device");s.delete("state");});
}
