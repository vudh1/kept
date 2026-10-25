/** Authenticated ciphertext-only sync. No user-facing URLs or shared API tokens. */
import { encryptWithKey, decryptWithKey } from "./crypto.js";
import { mergeState, validateState } from "./store.js";
export const BACKEND_URL="https://kept-sync.vudhone.workers.dev";
export async function api(path,token,options={}) {
  const response=await fetch(BACKEND_URL+path,{
    ...options,cache:"no-store",
    headers: {
      ...(token?{Authorization:"Bearer "+token}:{}),
      ...(options.body?{"Content-Type":"application/json"}:{})
    }
  });
  let result={};
  try{result=await response.json();}catch{}
  if(!response.ok){
    const error=new Error(result.error||("Kept service error ("+response.status+")."));
    error.status=response.status;throw error;
  }
  return result;
}
export const enrollDevice=(pin)=>api("/api/auth/enroll","",{method:"POST",body:JSON.stringify({pin})});
export const verifyDevice=(token)=>api("/api/auth/session",token);
export const changeHouseholdPin=(token,currentPin,newPin)=>api("/api/auth/pin",token,{method:"POST",body:JSON.stringify({currentPin,newPin})});
export const revokeDevice=(token)=>api("/api/auth/revoke",token,{method:"POST",body:"{}"});
export async function syncOnce(localState,session) {
  if(!session?.token||!session?.key)throw new Error("Unlock this device first.");
  let current=validateState(localState);
  for(let i=0;i<5;i++){
    const remote=await api("/api/state",session.token);
    if(remote.envelope){
      if(remote.envelope.v!==2)throw new Error("Existing remote data uses a legacy key. Migration is required before syncing.");
      const remoteData=validateState(await decryptWithKey(remote.envelope,session.key));
      current=mergeState(current,remoteData);
      // Polling and resume checks are read-only when there are no new edits.
      // Avoid unnecessary GitHub commits, API quotas and public timestamps.
      if(JSON.stringify(current)===JSON.stringify(remoteData))return current;
    }
    const envelope=await encryptWithKey(current,session.key);
    try{
      await api("/api/state",session.token,{method:"PUT",body:JSON.stringify({envelope,sha:remote.sha||null})});
      return current;
    }catch(e){if(e.status!==409||i===4)throw e;}
  }
  throw new Error("Concurrent household changes. Please retry.");
}
export const researchAppliance=(session,info)=>api("/api/research",session.token,{method:"POST",body:JSON.stringify(info)});
export const askAssistant=(session,message,appliance)=>api("/api/assist",session.token,{method:"POST",body:JSON.stringify({message,appliance})});
