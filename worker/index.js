/**
 * Kept Cloudflare Worker.
 * Privacy: ciphertext relay for GitHub branch state. Only explicitly provided appliance
 * model/manual data goes to Gemini and chat question/model metadata goes to Groq.
 * No passphrases or plaintext household documents are accepted by this Worker.
 */
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (payload, status=200, extra={}) => new Response(JSON.stringify(payload), { status, headers: { ...JSON_HEADERS, ...extra } });
function allowedOrigin(origin, env) {
  if (!origin) return true; // non-browser clients still require shared token
  const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map(x=>x.trim()).filter(Boolean);
  return allowed.includes(origin);
}
function corsHeaders(origin, env) {
  if (!origin || !allowedOrigin(origin, env)) return {};
  return { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Headers": "Content-Type, X-Kept-Key", "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS", "Access-Control-Max-Age": "600" };
}
function safeEqual(a,b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = new TextEncoder().encode(a), bb = new TextEncoder().encode(b);
  let difference = aa.length ^ bb.length;
  const length = Math.max(aa.length, bb.length);
  for (let i=0; i<length; i++) difference |= (aa[i]||0) ^ (bb[i]||0);
  return difference === 0;
}
function safeString(x, max) { return String(x ?? "").trim().slice(0,max); }
function utf8ToBase64(s) {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for(let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
function base64ToUtf8(s) {
  const chars = atob(s.replace(/\s/g,""));
  return new TextDecoder().decode(Uint8Array.from(chars,c=>c.charCodeAt(0)));
}
async function github(env, route, options={}) {
  if (!env.GITHUB_TOKEN || !/^[-\w.]+\/[-\w.]+$/.test(env.GITHUB_REPO||"")) throw new Error("GitHub credentials are not configured.");
  const response=await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${route}`, {
    ...options,
    headers: { "Accept": "application/vnd.github+json", "Authorization": `Bearer ${env.GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Kept-Home-Sync", ...(options.body ? { "Content-Type": "application/json" } : {}) }
  });
  if(response.status===404) return { status:404 };
  const value = await response.json().catch(()=>({}));
  return { status:response.status, data:value };
}
/**
 * runtime-state is a storage-only orphan branch. The root must contain zero
 * files (initial state) or exactly state.json as an AES-GCM envelope.
 * This audit prevents accidental publication of plaintext or source files.
 */
const STATE_BRANCH = "runtime-state";
function validEnvelope(e) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return false;
  if (Object.keys(e).sort().join(",") !== "algorithm,ciphertext,iv,salt,v") return false;
  if (e.v !== 1 || e.algorithm !== "PBKDF2-SHA256/AES-256-GCM") return false;
  if (![e.salt, e.iv, e.ciphertext].every(s => typeof s === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(s))) return false;
  // Salt = 128 bits, IV = 96 bits; GCM ciphertext includes a 128-bit tag.
  const b64Size = s => Math.floor(s.length * 3 / 4) - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);
  return b64Size(e.salt) === 16 && b64Size(e.iv) === 12 && b64Size(e.ciphertext) >= 16 &&
    e.ciphertext.length <= 3000000;
}
function assertStateConfiguration(env) {
  if (env.GITHUB_BRANCH !== STATE_BRANCH) {
    throw new Error("GITHUB_BRANCH must be runtime-state (never main).");
  }
}
async function readState(env) {
  assertStateConfiguration(env);
  const branch = encodeURIComponent(STATE_BRANCH);
  const root = await github(env, `/contents?ref=${branch}`);
  if (root.status === 404) {
    const ref = await github(env, `/git/ref/heads/${branch}`);
    if (ref.status === 404) return { envelope: null, sha: null, branchExists: false };
    if (ref.status !== 200) throw new Error(`Cannot inspect state branch (${ref.status}).`);
    // GitHub can return 404 for a root with no tracked files.
    return { envelope: null, sha: null, branchExists: true };
  }
  if (root.status !== 200 || !Array.isArray(root.data)) throw new Error(`State branch audit failed (${root.status}).`);
  if (root.data.length === 0) return { envelope: null, sha: null, branchExists: true };
  if (root.data.length !== 1 || root.data[0]?.name !== "state.json" || root.data[0]?.type !== "file") {
    throw new Error("State branch must contain only the encrypted state.json file.");
  }
  const result = await github(env, `/contents/state.json?ref=${branch}`);
  if (result.status !== 200 || !result.data?.content) throw new Error(`Encrypted state read failed (${result.status}).`);
  let envelope;
  try { envelope = JSON.parse(base64ToUtf8(result.data.content)); }
  catch { throw new Error("Encrypted state file is malformed."); }
  if (!validEnvelope(envelope)) throw new Error("Invalid AES-GCM envelope in state branch.");
  return { envelope, sha: result.data.sha, branchExists: true };
}
/**
 * When no state branch exists, create a root commit containing only the
 * encrypted envelope. Never copy the public main branch into runtime-state.
 */
async function createOrphanState(env, envelope) {
  const blob = await github(env, "/git/blobs", {
    method: "POST", body: JSON.stringify({ content: JSON.stringify(envelope) + "\n", encoding: "utf-8" })
  });
  if (blob.status !== 201 || !blob.data?.sha) throw new Error(`Encrypted state blob creation failed (${blob.status}).`);
  const tree = await github(env, "/git/trees", {
    method: "POST", body: JSON.stringify({ tree: [{ path: "state.json", mode: "100644", type: "blob", sha: blob.data.sha }] })
  });
  if (tree.status !== 201 || !tree.data?.sha) throw new Error(`Encrypted state tree creation failed (${tree.status}).`);
  const commit = await github(env, "/git/commits", {
    method: "POST", body: JSON.stringify({ message: "Initialize encrypted household state", tree: tree.data.sha, parents: [] })
  });
  if (commit.status !== 201 || !commit.data?.sha) throw new Error(`Orphan state commit creation failed (${commit.status}).`);
  const ref = await github(env, "/git/refs", {
    method: "POST", body: JSON.stringify({ ref: `refs/heads/${STATE_BRANCH}`, sha: commit.data.sha })
  });
  if (ref.status === 422) return json({ error: "State branch was created concurrently. Retry sync." }, 409);
  if (ref.status !== 201) throw new Error(`State branch creation failed (${ref.status}).`);
  return json({ ok: true, sha: blob.data.sha });
}
async function writeState(env, envelope, expectedSha) {
  assertStateConfiguration(env);
  if (!validEnvelope(envelope)) return json({ error: "Invalid AES-GCM envelope." }, 400);
  if (expectedSha !== null && (typeof expectedSha !== "string" || !/^[a-f0-9]{40}$/.test(expectedSha))) {
    return json({ error: "Invalid GitHub content SHA." }, 400);
  }
  const actual = await readState(env);
  if (actual.sha !== expectedSha) return json({ error: "State changed. Refresh and merge before retrying." }, 409);
  if (!actual.branchExists) return createOrphanState(env, envelope);
  const body = { message: "Update encrypted household state", content: utf8ToBase64(JSON.stringify(envelope) + "\n"), branch: STATE_BRANCH };
  if (expectedSha) body.sha = expectedSha;
  const response = await github(env, "/contents/state.json", { method: "PUT", body: JSON.stringify(body) });
  if ([409, 422].includes(response.status)) return json({ error: "Concurrent update. Please retry." }, 409);
  if (![200, 201].includes(response.status)) throw new Error(`Encrypted state write failed (${response.status}).`);
  return json({ ok: true, sha: response.data?.content?.sha });
}
function secureManualUrl(value) {
  let url;
  try { url=new URL(value); } catch { return false; }
  if(url.protocol!=="https:" || !url.hostname || url.username || url.password || url.port) return false;
  if(/^(localhost|.*\.local|.*\.internal)$/i.test(url.hostname)) return false;
  if(/^\d+(?:\.\d+){3}$/.test(url.hostname) || url.hostname.includes(":")) return false;
  return true;
}
function extractJson(text) {
  const cleaned=String(text||"").trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");
  try { return JSON.parse(cleaned); }
  catch {
    const start=cleaned.indexOf("{"), end=cleaned.lastIndexOf("}");
    if(start<0||end<start) throw new Error("AI did not return valid structured data.");
    return JSON.parse(cleaned.slice(start,end+1));
  }
}
async function research(env, body) {
  if(!env.GEMINI_API_KEY) return json({error:"Gemini is not configured. Add the GEMINI_API_KEY Worker secret."},503);
  const {category,brand,model,manualUrl}=body||{};
  if(!secureManualUrl(manualUrl) || !safeString(model,100) || !safeString(brand,80)) return json({error:"Provide a brand, model number, and public HTTPS manual URL."},400);
  const prompt=`You are a conservative household appliance maintenance researcher. Read ONLY the user-supplied official appliance manual URL using URL context. Never invent a schedule. The category, brand, and model must match the manual. Extract at most 10 explicit recurring maintenance tasks. If an interval is missing or uncertain, omit the task. Convert explicit intervals to approximate integer days (monthly=30, three months=90, yearly=365). Return ONLY JSON: {"tasks":[{"title":"...","intervalDays":30,"instructions":"...","evidence":"short exact supporting phrase from the manual"}]}. Include no guesses or unsupported product compatibility claims. If URL isn't accessible, model differs, or intervals aren't stated, return {"tasks":[]}. Appliance details: ${JSON.stringify({category:safeString(category,90),brand:safeString(brand,80),model:safeString(model,100),manualUrl})}`;
  const geminiModel=env.GEMINI_MODEL || "gemini-2.5-flash";
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,{
    method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],tools:[{url_context:{}}],generationConfig:{temperature:0.1,maxOutputTokens:1600}})
  });
  if(!response.ok) return json({error:`Gemini request failed (${response.status}). Check model and free-tier quota.`},502);
  const result=await response.json();
  const textOutput=(result.candidates?.[0]?.content?.parts||[]).map(x=>x.text||"").join("\n");
  let data;
  try {data=extractJson(textOutput);}catch{return json({error:"Could not parse the AI maintenance draft. Please retry."},502);}
  const tasks=(Array.isArray(data.tasks)?data.tasks:[]).filter(t=>typeof t?.title==="string"&&Number.isInteger(t.intervalDays)&&t.intervalDays>0&&t.intervalDays<=3650&&typeof t.evidence==="string"&&t.evidence.trim()).slice(0,10).map(t=>({
    title:safeString(t.title,120),intervalDays:t.intervalDays,instructions:safeString(t.instructions,800),evidence:safeString(t.evidence,200),sourceUrl:manualUrl
  }));
  return json({tasks,sourceUrl:manualUrl,verification:"AI draft; manually verify with official documentation"});
}
async function assist(env, body) {
  if(!env.GROQ_API_KEY) return json({error:"Groq is not configured. Add the GROQ_API_KEY Worker secret."},503);
  const message=safeString(body?.message,700);
  if(!message) return json({error:"Enter a question."},400);
  const appliance=body?.appliance && typeof body.appliance==="object" ? {category:safeString(body.appliance.category,80),brand:safeString(body.appliance.brand,80),model:safeString(body.appliance.model,80)} : null;
  const response=await fetch("https://api.groq.com/openai/v1/chat/completions",{
    method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${env.GROQ_API_KEY}`},body:JSON.stringify({model:env.GROQ_MODEL || "llama-3.3-70b-versatile",max_tokens:600,temperature:0.3,messages:[
      {role:"system",content:"You are Kept, a concise household maintenance assistant. Give safe general advice and differentiate general advice from exact-model instructions. Never claim you read a manual unless it was supplied and actually read. For electrical/gas/fire risks recommend qualified service. Do not fabricate parts, warranty, prices, inventory, or schedules. You have no access to the private household database."},
      {role:"user",content:`Appliance context (optional): ${JSON.stringify(appliance)}\nQuestion: ${message}`}
    ]})
  });
  if(!response.ok) return json({error:`Groq request failed (${response.status}). Check model and free-tier quota.`},502);
  const data=await response.json();
  return json({answer:safeString(data.choices?.[0]?.message?.content,2200)});
}
export async function handleRequest(request, env) {
  const origin=request.headers.get("Origin");
  if(!allowedOrigin(origin,env)) return json({error:"Origin not allowed."},403);
  const headers=corsHeaders(origin,env);
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers});
  const url=new URL(request.url);
  if(url.pathname==="/api/health" && request.method==="GET") return json({ok:true,service:"kept-sync"},200,headers);
  if(!env.SYNC_TOKEN || env.SYNC_TOKEN.length<24) return json({error:"Server access key not configured securely."},503,headers);
  if(!safeEqual(request.headers.get("X-Kept-Key"),env.SYNC_TOKEN)) return json({error:"Unauthorized."},401,headers);
  try {
    let result;
    if(url.pathname==="/api/state" && request.method==="GET") result=json(await readState(env));
    else if(url.pathname==="/api/state" && request.method==="PUT") {
      if(Number(request.headers.get("Content-Length")||0)>4500000) return json({error:"Body too large."},413,headers);
      const data=await request.json();
      result=await writeState(env,data.envelope,data.sha===undefined?null:data.sha);
    }
    else if(url.pathname==="/api/research" && request.method==="POST") {
      if(Number(request.headers.get("Content-Length")||0)>15000) return json({error:"Body too large."},413,headers);
      result=await research(env,await request.json());
    }
    else if(url.pathname==="/api/assist" && request.method==="POST") {
      if(Number(request.headers.get("Content-Length")||0)>15000) return json({error:"Body too large."},413,headers);
      result=await assist(env,await request.json());
    }
    else result=json({error:"Not found."},404);
    const h=new Headers(result.headers);for(const [k,v] of Object.entries(headers))h.set(k,v);
    return new Response(result.body,{status:result.status,headers:h});
  } catch(error) {
    console.warn("Kept request failed:",String(error?.message||"Unexpected error").slice(0,160));
    return json({error:"Request could not be completed. Check server configuration and retry."},500,headers);
  }
}
export default { fetch: handleRequest };
export { validEnvelope, secureManualUrl, safeEqual };
