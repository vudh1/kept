/** PIN verification and trusted-device storage. This Durable Object is NOT a public HTTP route. */
const enc = new TextEncoder();
const json = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { "Content-Type":"application/json", "Cache-Control":"no-store" } });
const hex = a => Array.from(a, x=>x.toString(16).padStart(2,"0")).join("");
const random = (count=32) => hex(crypto.getRandomValues(new Uint8Array(count)));
const validPin = p => typeof p === "string" && /^\d{8,12}$/.test(p);
async function hash(s) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(s)))); }
async function verifier(pin, pepper, salt) {
  const material = await crypto.subtle.importKey("raw", enc.encode(pepper+":"+pin), "PBKDF2", false, ["deriveBits"]);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2", salt:enc.encode(salt), iterations:130000, hash:"SHA-256"}, material, 256)));
}
function equal(a,b) {
  const x=enc.encode(String(a)), y=enc.encode(String(b));
  let d=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)d|=(x[i]||0)^(y[i]||0);
  return d===0;
}
export class HouseholdAccess {
  constructor(state,env) {this.state=state;this.env=env;this.queue=Promise.resolve();}
  async device(token) {
    if(!/^[a-f0-9]{64}$/.test(token||""))return null;
    const key="device:"+await hash(token);
    const entry=await this.state.storage.get(key);
    const epoch=await this.state.storage.get("epoch")||1;
    if(!entry||entry.epoch!==epoch||entry.expires<Date.now())return null;
    // Active household devices renew their 180-day session without another PIN.
    if(entry.expires-Date.now()<150*86400000){entry.expires=Date.now()+180*86400000;await this.state.storage.put(key,entry);}
    return {key,entry};
  }
  async issue() {
    const token=random();
    await this.state.storage.put("device:"+await hash(token),{
      epoch:await this.state.storage.get("epoch")||1, expires:Date.now()+180*86400000
    });
    return token;
  }
  async check(pin) {
    const now=Date.now();
    const failures=await this.state.storage.get("failed")||{count:0,until:0};
    if(failures.until>now)return {status:429};
    if(!validPin(pin))return {status:401};
    const saved=await this.state.storage.get("pin");
    let ok=false;
    if(saved)ok=equal(saved.digest,await verifier(pin,this.env.KEPT_PIN_PEPPER,saved.salt));
    else if(validPin(this.env.KEPT_INITIAL_PIN))ok=equal(pin,this.env.KEPT_INITIAL_PIN);
    if(ok){
      if(!saved){
        const salt=random(16);
        await this.state.storage.put("pin",{salt,digest:await verifier(pin,this.env.KEPT_PIN_PEPPER,salt)});
      }
      await this.state.storage.delete("failed");
      return {status:200};
    }
    failures.count=(failures.count||0)+1;
    failures.until=failures.count>=5?now+15*60000:0;
    await this.state.storage.put("failed",failures);
    return {status:failures.until?429:401};
  }
  async dataKey() {
    let key=await this.state.storage.get("dataKey");
    if(!key){key=random();await this.state.storage.put("dataKey",key);}
    return key;
  }
  async process(request) {
    if(!this.env.KEPT_PIN_PEPPER||this.env.KEPT_PIN_PEPPER.length<32)return json({error:"Household PIN not configured."},503);
    const path=new URL(request.url).pathname;
    const token=(request.headers.get("Authorization")||"").replace(/^Bearer /,"");
    if(path==="/verify")return (await this.device(token))?json({ok:true}):json({error:"Not authorized."},401);
    if(path==="/session"){
      if(!await this.device(token))return json({error:"Device revoked or expired."},401);
      return json({ok:true,key:await this.dataKey()});
    }
    if(path==="/revoke"&&request.method==="POST"){
      const d=await this.device(token);
      if(!d)return json({error:"Not authorized."},401);
      await this.state.storage.delete(d.key);return json({ok:true});
    }
    if(request.method!=="POST")return json({error:"Unsupported method."},405);
    const raw=await request.text();
    if(raw.length>300)return json({error:"Request too large."},413);
    let input;try{input=JSON.parse(raw);}catch{return json({error:"Invalid request."},400);}
    if(path==="/enroll"){
      const c=await this.check(input.pin);
      if(c.status!==200)return json({error:c.status===429?"Too many attempts. Try in 15 minutes.":"Incorrect PIN."},c.status);
      return json({ok:true,token:await this.issue(),key:await this.dataKey()});
    }
    if(path==="/pin"){
      if(!await this.device(token))return json({error:"Not authorized."},401);
      const c=await this.check(input.currentPin);
      if(c.status!==200)return json({error:c.status===429?"Too many attempts. Try in 15 minutes.":"Incorrect current PIN."},c.status);
      if(!validPin(input.newPin)||input.newPin===input.currentPin)return json({error:"Choose a different 8–12 digit PIN."},400);
      const salt=random(16);
      await this.state.storage.put("pin",{salt,digest:await verifier(input.newPin,this.env.KEPT_PIN_PEPPER,salt)});
      await this.state.storage.put("epoch",(await this.state.storage.get("epoch")||1)+1);
      return json({ok:true,token:await this.issue()});
    }
    return json({error:"Not found."},404);
  }
  fetch(request) {
    // Serialize attempts, PIN changes and key initialization for this household.
    const result=this.queue.then(()=>this.process(request));
    this.queue=result.catch(()=>{});
    return result;
  }
}
