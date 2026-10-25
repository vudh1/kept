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
  page.on("pageerror", e => pageErrors.push(e.message));
  page.on("console", m => { if (m.type() === "error") pageErrors.push(m.text()); });
  try {
    const response = await page.goto(target, { waitUntil: "networkidle", timeout: 30000 });
    if (!response?.ok()) throw new Error("Home page HTTP " + response?.status());
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
    await page.getByRole("button",{name:"Appliances"}).click();
    await page.getByText("Test washer").first().waitFor({state:"visible",timeout:8000});
    await page.getByText("Test washer").first().click();
    await page.getByText("Clean washer tub and gasket").first().waitFor({state:"visible",timeout:8000});
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
