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
  const accessToken = "f".repeat(64);
  const dataKey = "a1".repeat(32);
  let stored = null;
  let sha = null;
  // API replies are intercepted in the test process; no real household data is accessed.
  await context.route("https://kept-sync.vudhone.workers.dev/**", async route => {
    const req=route.request(), path=new URL(req.url()).pathname;
    const origin=new URL(target).origin;
    const headers={"Access-Control-Allow-Origin":origin,
      "Access-Control-Allow-Headers":"Content-Type, Authorization",
      "Access-Control-Allow-Methods":"GET, PUT, POST, OPTIONS"};
    const ok=(data,status=200)=>route.fulfill({status,contentType:"application/json",headers,body:JSON.stringify(data)});
    if(req.method()==="OPTIONS")return route.fulfill({status:204,headers});
    if(path==="/api/auth/enroll")return ok({ok:true,token:accessToken,key:dataKey});
    if(path==="/api/auth/session")return ok({ok:true,key:dataKey});
    if(path==="/api/state"&&req.method()==="GET")return ok({envelope:stored,sha});
    if(path==="/api/state"&&req.method()==="PUT"){
      const body=JSON.parse(req.postData());
      if((body.sha||null)!==(sha||null))return ok({error:"Conflict"},409);
      stored=body.envelope;sha="b".repeat(40);return ok({ok:true,sha});
    }
    return ok({error:"Unmocked endpoint"},404);
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
    if(!stored || stored.v!==2 || JSON.stringify(stored).includes("Test washer"))
      throw new Error("Remote state was not encrypted and uploaded.");
    const plaintext=await page.evaluate(()=>localStorage.getItem("kept.household.v1"));
    if(plaintext!==null)throw new Error("Plaintext device storage not removed");
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
