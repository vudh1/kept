/** Auth is Cloudflare Durable Object state, not the browser PIN. */
import test from "node:test";
import assert from "node:assert/strict";
import { HouseholdAccess } from "../worker/auth.js";
const headers = {"Content-Type":"application/json"};
const TEST_ENV = {KEPT_INITIAL_PIN:"83519462",KEPT_PIN_PEPPER:"unit-test-only-pepper-that-is-long-enough-0123456789"};
function setup(){
  const map=new Map();
  const storage={
    get:async k=>map.get(k),
    put:async (k,v)=>{map.set(k,v);},
    delete:async k=>{map.delete(k);}
  };
  const auth=new HouseholdAccess({storage},TEST_ENV);
  const call=(path,data,token="")=>auth.fetch(new Request("https://kept-internal.invalid"+path,{
    method:data===undefined?"GET":"POST",
    headers:{...headers,...(token?{Authorization:"Bearer "+token}:{})},
    ...(data===undefined?{}:{body:JSON.stringify(data)})
  }));
  return {auth,call,map};
}
test("PIN is checked on server; issued token is random and not the PIN",async()=>{
  const {call,map}=setup();
  const wrong=await call("/enroll",{pin:"00000000"});
  assert.equal(wrong.status,401);
  const ok=await call("/enroll",{pin:TEST_ENV.KEPT_INITIAL_PIN});
  assert.equal(ok.status,200);
  const data=await ok.json();
  assert.match(data.token,/^[0-9a-f]{64}$/);
  assert.match(data.key,/^[0-9a-f]{64}$/);
  assert.notEqual(data.token,data.key);
  assert.ok(!JSON.stringify([...map.values()]).includes(data.token));
  assert.ok(!JSON.stringify([...map.values()]).includes(TEST_ENV.KEPT_INITIAL_PIN));
  const valid=await call("/session",undefined,data.token);
  assert.equal(valid.status,200);
  assert.equal((await valid.json()).key,data.key);
});
test("five wrong PINs block correct PIN; concurrent requests share lockout",async()=>{
  const {call}=setup();
  const attempts=await Promise.all(Array.from({length:5},()=>call("/enroll",{pin:"00000000"})));
  assert.deepEqual(attempts.map(x=>x.status),[401,401,401,401,429]);
  assert.equal((await call("/enroll",{pin:TEST_ENV.KEPT_INITIAL_PIN})).status,429);
});
test("changing the PIN revokes all other device tokens and retains data key",async()=>{
  const {call}=setup();
  const a=await (await call("/enroll",{pin:TEST_ENV.KEPT_INITIAL_PIN})).json();
  const b=await (await call("/enroll",{pin:TEST_ENV.KEPT_INITIAL_PIN})).json();
  const changed=await call("/pin",{currentPin:TEST_ENV.KEPT_INITIAL_PIN,newPin:"49162835"},a.token);
  assert.equal(changed.status,200);
  const c=await changed.json();
  assert.equal((await call("/session",undefined,b.token)).status,401);
  assert.equal((await call("/session",undefined,a.token)).status,401);
  assert.equal((await call("/session",undefined,c.token)).status,200);
  assert.equal((await (await call("/session",undefined,c.token)).json()).key,a.key);
  assert.equal((await call("/enroll",{pin:TEST_ENV.KEPT_INITIAL_PIN})).status,401);
  assert.equal((await call("/enroll",{pin:"49162835"})).status,200);
});
test("forgetting one device does not erase other household sessions",async()=>{
  const {call}=setup();
  const a=await (await call("/enroll",{pin:TEST_ENV.KEPT_INITIAL_PIN})).json();
  const b=await (await call("/enroll",{pin:TEST_ENV.KEPT_INITIAL_PIN})).json();
  assert.equal((await call("/revoke",{},a.token)).status,200);
  assert.equal((await call("/session",undefined,a.token)).status,401);
  assert.equal((await call("/session",undefined,b.token)).status,200);
});
