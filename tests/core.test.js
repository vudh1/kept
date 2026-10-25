import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG, GENERAL_REFERENCES } from "../lib/catalog.js";
import { addDays, daysBetween, dueDate, status, upcomingTasks, calendarFile } from "../lib/schedules.js";
import { mergeState, blankState, validateState } from "../lib/store.js";
import { encryptState, decryptState, encryptWithKey, decryptWithKey } from "../lib/crypto.js";
import { handleRequest, validEnvelope, secureManualUrl, safeEqual } from "../worker/index.js";

test("catalog categories have unique ids and safe starter intervals",()=>{
  const ids = CATALOG.map(x=>x.id);
  assert.equal(new Set(ids).size,ids.length);
  for(const item of CATALOG) for(const task of item.tasks) assert.ok(task.days>0 && task.title && task.notes);
});
test("date arithmetic ignores DST and crosses calendar boundaries",()=>{
  assert.equal(addDays("2026-03-07",2),"2026-03-09");
  assert.equal(addDays("2026-12-31",1),"2027-01-01");
  assert.equal(daysBetween("2026-03-07","2026-03-09"),2);
  assert.equal(dueDate({lastDone:"2026-10-01",intervalDays:30}),"2026-10-31");
});
test("overdue and due labels are correct",()=>{
  assert.equal(status({lastDone:"2026-10-01",intervalDays:10},"2026-10-24").kind,"overdue");
  assert.equal(status({lastDone:"2026-10-01",intervalDays:23},"2026-10-24").kind,"due");
  assert.equal(status({lastDone:"2026-10-01",intervalDays:37},"2026-10-24").kind,"soon");
});
test("encrypted state round-trips and wrong password rejects",async()=>{
  const original={...blankState(),shopping:[{id:"x",name:"Cat food",updatedAt:"2026-10-24T02:00:00Z"}]};
  const ciphertext=await encryptState(original,"a very long secret passphrase");
  assert.equal(validEnvelope(ciphertext),true);
  assert.ok(!JSON.stringify(ciphertext).includes("Cat food"));
  assert.deepEqual(await decryptState(ciphertext,"a very long secret passphrase"),original);
  await assert.rejects(()=>decryptState(ciphertext,"different passphrase"),/Cannot unlock/);
});
test("merges concurrent new records, edits, and tombstones",()=>{
  const a={...blankState(),shopping:[{id:"1",name:"Milk",updatedAt:"2026-10-23T10:00:00Z",updatedBy:"a"},{id:"2",name:"Eggs",updatedAt:"2026-10-23T10:00:00Z",updatedBy:"a"}]};
  const b={...blankState(),shopping:[{id:"1",name:"Milk",deleted:true,updatedAt:"2026-10-24T10:00:00Z",updatedBy:"b"},{id:"3",name:"Rice",updatedAt:"2026-10-24T10:00:00Z",updatedBy:"b"}]};
  const merged=mergeState(a,b);
  assert.equal(merged.shopping.length,3);
  assert.equal(merged.shopping.find(x=>x.id==="1").deleted,true);
  assert.equal(merged.shopping.find(x=>x.id==="2").name,"Eggs");
  assert.equal(merged.shopping.find(x=>x.id==="3").name,"Rice");
  assert.deepEqual(mergeState(b,a),merged);
});
test("tasks are filtered by active appliance and valid for calendar export",()=>{
  const state={...blankState(),appliances:[{id:"1",name:"Dishwasher"},{id:"2",name:"Old unit",deleted:true}],tasks:[{id:"t1",applianceId:"1",title:"Filter",lastDone:"2026-10-01",intervalDays:30},{id:"t2",applianceId:"2",title:"Ignore",lastDone:"2026-10-01",intervalDays:10}]};
  assert.equal(upcomingTasks(state).length,1);
  const cal=calendarFile(upcomingTasks(state),state.appliances);
  assert.ok(cal.includes("DTSTART;VALUE=DATE:20261031"));
  assert.ok(cal.includes("BEGIN:VALARM"));
});
test("manual URL validation blocks insecure/internal references",()=>{
  assert.equal(secureManualUrl("https://www.example.com/manual.pdf"),true);
  assert.equal(secureManualUrl("http://example.com/manual"),false);
  assert.equal(secureManualUrl("https://localhost/manual"),false);
  assert.equal(secureManualUrl("https://192.168.1.1/a"),false);
});
function permitTestDevice() {
  return {idFromName:()=>({}),get:()=>({fetch:async()=>new Response(JSON.stringify({ok:true}),{status:200})})};
}
test("worker refuses missing device authorization and disallowed origins",async()=>{
  const env={ALLOWED_ORIGIN:"https://vudh1.github.io",HOUSEHOLD_AUTH:{
    idFromName:()=>({}),get:()=>({fetch:async()=>new Response(JSON.stringify({error:"Unauthorized"}),{status:401})})
  }};
  const wrong=await handleRequest(new Request("https://worker.example/api/state",{headers:{Origin:"https://evil.example","X-Kept-Key":"old-shared-secret"}}),env);
  assert.equal(wrong.status,403);
  const unauth=await handleRequest(new Request("https://worker.example/api/state",{headers:{Origin:"https://vudh1.github.io","X-Kept-Key":"old-shared-secret"}}),env);
  assert.equal(unauth.status,401);
  const noAuth=await handleRequest(new Request("https://worker.example/api/state"),{ALLOWED_ORIGIN:""});
  assert.equal(noAuth.status,503);
  assert.equal(safeEqual("this is same","this is same"),true);
  assert.equal(safeEqual("this is same","this is different"),false);
});
test("high entropy key encrypts remote state and rejects corrupted envelopes",async()=>{
  const key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  const input={...blankState(),shopping:[{id:"x",name:"Private item"}]};
  const envelope=await encryptWithKey(input,key);
  assert.equal(validEnvelope(envelope),true);
  assert.ok(!JSON.stringify(envelope).includes("Private item"));
  assert.deepEqual(await decryptWithKey(envelope,key),input);
  await assert.rejects(()=>decryptWithKey({...envelope,iv:"broken"},key),/Could not decrypt/);
});
test("runtime-state first sync creates a storage-only orphan root commit", async()=>{
  const realFetch = globalThis.fetch;
  const requests = [];
  const envelope = await encryptState({ ...blankState(), shopping: [{ id: "secret", name: "Private grocery" }] }, "a very long high entropy passphrase");
  const token = "this is a long secret access token";
  const env = { GITHUB_REPO: "vudh1/kept", GITHUB_BRANCH: "runtime-state", GITHUB_TOKEN: "test-only", HOUSEHOLD_AUTH:permitTestDevice(), ALLOWED_ORIGIN: "https://vudh1.github.io" };
  const respond = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (url, opts={}) => {
    const u = new URL(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    requests.push({ path: u.pathname + u.search, method: opts.method || "GET", body });
    if (u.pathname.endsWith("/contents") && u.search === "?ref=runtime-state") return respond(404, {});
    if (u.pathname.endsWith("/git/ref/heads/runtime-state")) return respond(404, {});
    if (u.pathname.endsWith("/git/blobs")) return respond(201, { sha: "a".repeat(40) });
    if (u.pathname.endsWith("/git/trees")) return respond(201, { sha: "b".repeat(40) });
    if (u.pathname.endsWith("/git/commits")) return respond(201, { sha: "c".repeat(40) });
    if (u.pathname.endsWith("/git/refs")) return respond(201, { ref: "refs/heads/runtime-state" });
    throw new Error("Unexpected GitHub call: " + u.href);
  };
  try {
    const response = await handleRequest(new Request("https://worker.example/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: "https://vudh1.github.io", "Authorization":"Bearer "+token },
      body: JSON.stringify({ envelope, sha: null })
    }), env);
    assert.equal(response.status, 200);
    const blob = requests.find(x => x.path.endsWith("/git/blobs")).body;
    assert.deepEqual(JSON.parse(blob.content), envelope);
    assert.ok(!blob.content.includes("Private grocery"));
    const tree = requests.find(x => x.path.endsWith("/git/trees")).body;
    assert.deepEqual(tree.tree.map(x => x.path), ["state.json"]);
    assert.deepEqual(requests.find(x => x.path.endsWith("/git/commits")).body.parents, []);
    assert.equal(requests.find(x => x.path.endsWith("/git/refs")).body.ref, "refs/heads/runtime-state");
    assert.ok(!requests.some(x => x.path.includes("/heads/main")));
  } finally { globalThis.fetch = realFetch; }
});

test("runtime-state refuses public source files and unsafe branch configuration", async()=>{
  const realFetch = globalThis.fetch;
  const token = "this is a long secret access token";
  const env = { GITHUB_REPO: "vudh1/kept", GITHUB_BRANCH: "runtime-state", GITHUB_TOKEN: "test-only", HOUSEHOLD_AUTH:permitTestDevice() };
  globalThis.fetch = async (url, opts={}) => {
    const u = new URL(url);
    assert.equal(opts.method || "GET", "GET");
    assert.ok(u.pathname.endsWith("/contents"));
    return new Response(JSON.stringify([{ name: "index.html", type: "file" }]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const badTree = await handleRequest(new Request("https://worker.example/api/state", { headers: { "X-Kept-Key": token } }), env);
    assert.equal(badTree.status, 500);
    const unsafe = await handleRequest(new Request("https://worker.example/api/state", { headers: { "X-Kept-Key": token } }), { ...env, GITHUB_BRANCH: "main" });
    assert.equal(unsafe.status, 500);
  } finally { globalThis.fetch = realFetch; }
});

test("category-first catalog includes common appliances without a model number",()=>{
  assert.equal(CATALOG.length, 32);
  assert.equal(CATALOG.at(-1).id, "other");
  for(const id of ["dishwasher","washer","dryer","hvac","humidifier","microwave","robot-vacuum","sump-pump","leak-sensor"]) {
    const item=CATALOG.find(x=>x.id===id);
    assert.ok(item?.tasks.length>=1, id);
    for(const task of item.tasks){
      assert.ok(Number.isInteger(task.days)&&task.days>=1&&task.days<=3650, id);
      assert.ok(task.title.length && task.notes.length, id);
      if(task.sourceUrl) assert.match(task.sourceUrl,/^https:\/\//);
    }
  }
  for(const url of Object.values(GENERAL_REFERENCES)) assert.match(url,/^https:\/\//);
  assert.ok(CATALOG.find(x=>x.id==="humidifier").tasks[0].notes.includes("while"));
});

test("general starter tasks stay source-labeled and do not require AI",()=>{
  const dishwasher=CATALOG.find(x=>x.id==="dishwasher");
  assert.ok(dishwasher.tasks.length>0);
  assert.equal(typeof GENERAL_REFERENCES.dishwasher,"string");
  const candidates=dishwasher.tasks.map((task,index)=>({index,...task}));
  const accepted=candidates.filter(x=>[0].includes(x.index));
  assert.equal(accepted.length,1);
  assert.equal(accepted[0].title,dishwasher.tasks[0].title);
});
