/** Real mobile browser UI test, using isolated same-origin fake API responses.
 * Never uses production PINs, Worker tokens or household records.
 */
import { chromium, webkit, devices } from "playwright";
const target=process.env.KEPT_TEST_URL||"http://127.0.0.1:4173/";
const engineSet=[
  ["chromium-mobile",chromium,{viewport:{width:390,height:844},isMobile:true,hasTouch:true}],
  ["webkit-iphone",webkit,{...devices["iPhone 13"]}]
];
let failures=0;
for(const [engine,browserType,deviceOptions] of engineSet){
  const browser=await browserType.launch({headless:true});
  const token="f".repeat(64),key="a1".repeat(32);
  let remote=null,sha=null;
  const configure=async context=>{
    await context.route("**/lib/sync.js",async route=>{
      const response=await route.fetch();
      const raw=await response.text();
      const patched=raw.replace('https://kept-sync.vudhone.workers.dev','');
      if(patched===raw)throw Error("Backend endpoint replacement failed");
      await route.fulfill({response,body:patched});
    });
    await context.route("**/api/**",async route=>{
      const req=route.request(),pathname=new URL(req.url()).pathname;
      const method=req.method(),auth=req.headers().authorization;
      const reply=(data,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(data)});
      if(pathname==="/api/auth/enroll"&&method==="POST")return reply({ok:true,token,key});
      if(pathname==="/api/auth/session")return reply({ok:true,key});
      if(auth!=="Bearer "+token)return reply({error:"Unauthorized"},401);
      if(pathname==="/api/state"&&method==="GET")return reply({envelope:remote,sha});
      if(pathname==="/api/state"&&method==="PUT"){
        const request=JSON.parse(req.postData()||"{}");
        if((request.sha||null)!==(sha||null))return reply({error:"Concurrent update"},409);
        remote=request.envelope;sha="b".repeat(40);return reply({ok:true,sha});
      }
      return reply({error:"Unmocked endpoint"},404);
    });
  };
  const context=await browser.newContext({...deviceOptions,serviceWorkers:"block"});
  const page=await context.newPage();
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  try{
    await configure(context);
    const load=await page.goto(target,{waitUntil:"networkidle",timeout:30000});
    if(!load?.ok())throw Error("Page HTTP "+load?.status());
    await page.locator("#household-pin").waitFor({state:"visible",timeout:8000});
    // Seed fake previous-version data: it must migrate after PIN enrollment.
    await page.evaluate(()=>localStorage.setItem("kept.household.v1",JSON.stringify({
      version:1,appliances:[],tasks:[],history:[],
      shopping:[{id:"legacy-fake",name:"Offline test item",updatedAt:"2026-10-25T00:00:00Z",updatedBy:"test"}]
    })));
    await page.locator("#household-pin").fill("83519462");
    await page.getByRole("button",{name:"Unlock this device"}).click();
    await page.getByRole("button",{name:"Appliances"}).click();
    await page.getByRole("button",{name:"Add new"}).click();
    await page.locator("#editor").waitFor({state:"visible",timeout:8000});
    await page.locator("#appliance-category").selectOption("washer");
    await page.locator("#editor input[name=name]").fill("Test washer");
    await page.locator("#editor button[type=submit]").click();
    await page.locator("#editor").waitFor({state:"hidden",timeout:8000});
    await page.getByRole("heading",{name:"Test washer"}).waitFor({state:"visible",timeout:8000});
    await page.getByText("Clean washer tub and gasket").first().waitFor({state:"visible",timeout:8000});
    await page.waitForFunction(()=>!localStorage.getItem("kept.household.v1"),{timeout:10000});
    for(let i=0;i<30 && !remote;i++)await new Promise(r=>setTimeout(r,100));
    if(!remote || remote.v!==2 || JSON.stringify(remote).includes("Test washer"))throw Error("Missing encrypted cloud upload");
    await page.reload({waitUntil:"networkidle",timeout:30000});
    await page.getByRole("button",{name:"Appliances"}).click();
    if(await page.locator("#household-pin").isVisible())throw Error("Remembered device requested a PIN");
    await page.getByText("Test washer").first().click();
    await page.getByText("Clean washer tub and gasket").first().waitFor({state:"visible",timeout:8000});

    const secondContext=await browser.newContext({...deviceOptions,serviceWorkers:"block"});
    try{
      await configure(secondContext);
      const second=await secondContext.newPage();
      await second.goto(target,{waitUntil:"networkidle",timeout:30000});
      await second.locator("#household-pin").fill("83519462");
      await second.getByRole("button",{name:"Unlock this device"}).click();
      await second.getByRole("button",{name:"Appliances"}).click();
      await second.getByText("Test washer").first().waitFor({state:"visible",timeout:8000});
      await second.getByRole("button",{name:"Shopping list"}).click();
      await second.getByText("Offline test item").first().waitFor({state:"visible",timeout:8000});
    } finally{await secondContext.close();}
    if(errors.length)throw Error("Page errors: "+errors.join("; "));
    console.log("PASS "+engine+" - PIN enrollment, migration, encrypted upload, reload, and second-device sync.");
  }catch(error){
    failures++;
    console.error("FAIL "+engine+": "+error.message);
    console.error("URL="+page.url()+" errors="+JSON.stringify(errors.slice(0,5)));
    console.error("Body="+(await page.locator("body").innerText().catch(()=>"")).slice(0,900));
  }finally{await browser.close();}
}
if(failures)process.exitCode=1;
