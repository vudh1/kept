/** Real browser smoke test against the running Kept PWA. No network credentials, test state stays in isolated browser context. */
import { chromium, webkit, devices } from "playwright";

const target = process.env.KEPT_TEST_URL || "http://127.0.0.1:4173/";
const isProduction = target.startsWith("https://");
const configurations = [
  ["chromium-mobile", chromium, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ["webkit-iphone", webkit, { ...devices["iPhone 13"] }]
];
let failureCount = 0;
for (const [name, browserType, contextOptions] of configurations) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: "allow" });
  const page = await context.newPage();

  const pageErrors = [];

  // Cross-origin interception of browser preflights varies by engine, so fake
  // just the Worker fetch interface in the test document, never the app logic.
  const mockBackendScript=()=>{
    const original=window.fetch.bind(window);
    const token="f".repeat(64),key="a1".repeat(32);
    window.fetch=(input,options={})=>{
      const url=String(typeof input==="string"?input:input?.url||"");
      if(!url.startsWith("https://kept-sync.vudhone.workers.dev/"))return original(input,options);
      const path=new URL(url).pathname,method=options.method||"GET";
      let stored=null;
      try{stored=JSON.parse(sessionStorage.getItem("__test_kept_cloud")||"null");}catch{}
      const respond=(data,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}}));
      if(path==="/api/auth/enroll")return respond({ok:true,token,key});
      if(path==="/api/auth/session")return respond({ok:true,key});
      if(path==="/api/state"&&method==="GET")return respond(stored||{envelope:null,sha:null});
      if(path==="/api/state"&&method==="PUT"){
        const body=JSON.parse(options.body);
        if((body.sha||null)!==(stored?.sha||null))return respond({error:"Conflict"},409);
        sessionStorage.setItem("__test_kept_cloud",JSON.stringify({envelope:body.envelope,sha:"b".repeat(40)}));
        return respond({ok:true,sha:"b".repeat(40)});
      }
      return respond({error:"Unmocked"},404);
    };
  };
  await page.addInitScript(mockBackendScript);
  await page.addInitScript(()=>{
    if(localStorage.getItem("__seeded-legacy")!=="1"){
      localStorage.setItem("kept.household.v1",JSON.stringify({
        version:1,appliances:[],tasks:[],history:[],
        shopping:[{id:"legacy-fake",name:"Offline test item",updatedAt:"2026-10-25T00:00:00Z",updatedBy:"test"}]
      }));
      localStorage.setItem("__seeded-legacy","1");
    }
  });
  page.on("pageerror", e => pageErrors.push(e.message));
  page.on("console", m => { if (m.type() === "error") pageErrors.push(m.text()); });
  try {
    const response = await page.goto(target, { waitUntil: "networkidle", timeout: 30000 });
    if (!response?.ok()) throw new Error("Home page HTTP " + response?.status());
    await page.locator("#household-pin").waitFor({state:"visible",timeout:8000});
    await page.locator("#household-pin").fill("83519462");
    await page.getByRole("button",{name:"Unlock this device"}).click();
    await page.getByRole("button", {name:"Appliances"}).click();
    await page.getByRole("button", {name:"Add new"}).click();
    await page.locator("#editor").waitFor({state:"visible",timeout:8000});
    await page.locator("#appliance-category").selectOption("washer");
    await page.locator("#editor input[name=name]").fill("Test washer");
    await page.locator("#editor button[type=submit]").click();
    await page.locator("#editor").waitFor({state:"hidden",timeout:8000});
    await page.getByRole("heading", {name:"Test washer"}).waitFor({state:"visible",timeout:8000});
    await page.getByText("Clean washer tub and gasket").first().waitFor({state:"visible",timeout:8000});
    await page.reload({waitUntil:"networkidle",timeout:30000});
    await page.getByRole("button",{name:"Appliances"}).waitFor({state:"visible",timeout:8000});
    if(await page.locator("#household-pin").isVisible())throw new Error("Trusted device requested PIN after reload");
    await page.getByRole("button",{name:"Appliances"}).click();
    await page.getByText("Test washer").first().waitFor({state:"visible",timeout:8000});
    await page.getByText("Test washer").first().click();
    await page.getByText("Clean washer tub and gasket").first().waitFor({state:"visible",timeout:8000});
    const stored=await page.evaluate(()=>JSON.parse(sessionStorage.getItem("__test_kept_cloud")||"null"));
    if(!stored?.envelope || stored.envelope.v!==2 || JSON.stringify(stored).includes("Test washer"))
      throw new Error("Remote state was not encrypted and uploaded.");
    const plaintext=await page.evaluate(()=>localStorage.getItem("kept.household.v1"));
    if(plaintext!==null)throw new Error("Plaintext device storage not removed");

    const freshContext=await browser.newContext({ ...contextOptions,serviceWorkers:"allow" });
    const second=await freshContext.newPage();
    await second.addInitScript(mockBackendScript);
    await second.addInitScript(snapshot=>sessionStorage.setItem("__test_kept_cloud",JSON.stringify(snapshot)),stored);
    try {
      await second.goto(target,{waitUntil:"networkidle",timeout:30000});
      await second.locator("#household-pin").fill("83519462");
      await second.getByRole("button",{name:"Unlock this device"}).click();
      await second.getByRole("button",{name:"Appliances"}).click();
      await second.getByText("Test washer").first().waitFor({state:"visible",timeout:8000});
      await second.getByRole("button",{name:"Shopping list"}).click();
      await second.getByText("Offline test item").first().waitFor({state:"visible",timeout:8000});
    } finally {await freshContext.close();}
    if(pageErrors.length) throw new Error("Browser JS errors: "+pageErrors.slice(0,6).join("; "));
    console.log("PASS "+name+" "+(isProduction?"production":"local")+" - add, view, reload, reopen.");
  } catch (e) {
    failureCount++;
    console.error("FAIL "+name+" "+(isProduction?"production":"local")+": "+e.message);
    console.error("URL="+page.url()+" page errors="+JSON.stringify(pageErrors.slice(0,8)));
    console.error("Dialog open="+(await page.locator("#editor").evaluate(x=>x.open).catch(()=>false)));
    console.error("Current body="+(await page.locator("body").innerText().catch(()=>"<none>")).slice(0,750));
  } finally {
    await browser.close();
  }
}
if(failureCount) process.exitCode=1;
