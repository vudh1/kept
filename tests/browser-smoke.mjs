/** Real browser smoke test against the running Kept PWA. No network credentials, test state stays in isolated browser context. */
import { chromium, webkit, devices } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const target = process.env.KEPT_TEST_URL || "http://127.0.0.1:4173/";
const isProduction = target.startsWith("https://");
const screenshotDir = process.env.KEPT_SCREENSHOT_DIR;
const configurations = [
  ["chromium-mobile", chromium, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ["webkit-iphone", webkit, { ...devices["iPhone 13"] }]
];
const selectedBrowser = process.env.KEPT_BROWSER;
let failureCount = 0;
for (const [name, browserType, contextOptions] of configurations) {
  if (selectedBrowser && !name.startsWith(selectedBrowser)) continue;
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: "allow" });
  const page = await context.newPage();
  const pageErrors = [];
  const externalRequests = [];
  page.on("pageerror", e => pageErrors.push(e.message));
  page.on("console", m => { if (m.type() === "error") pageErrors.push(m.text()); });
  page.on("request", request => { if (!request.url().startsWith(new URL(target).origin)) externalRequests.push(request.url()); });
  try {
    const response = await page.goto(target, { waitUntil: "networkidle", timeout: 30000 });
    if (!response?.ok()) throw new Error("Home page HTTP " + response?.status());
    await page.getByRole("heading",{name:"Everything feels in place."}).waitFor();
    if (await page.locator(".tabbar .nav-item").count() !== 4) throw new Error("Expected four bottom navigation targets");
    for (const nav of await page.locator(".tabbar .nav-item").all()) {
      if (!await nav.isVisible() || (await nav.boundingBox())?.height < 44) throw new Error("Navigation not reachable by touch");
    }
    await page.locator("#quick-item").fill("Synthetic oat milk");
    await page.locator("#quick-add button[type=submit]").click();
    await page.getByText("Synthetic oat milk").first().waitFor();
    await page.getByRole("button",{name:"Shopping list"}).click();
    await page.getByRole("button",{name:"Check off Synthetic oat milk"}).click();
    await page.getByRole("button",{name:"Put back Synthetic oat milk"}).waitFor();
    await page.getByRole("button",{name:"Put back Synthetic oat milk"}).click();
    await page.getByRole("button",{name:"Check off Synthetic oat milk"}).waitFor();
    await page.getByRole("button", {name:"Appliances"}).click();
    await page.getByRole("button", {name:"Add new"}).click();
    await page.locator("#editor").waitFor({state:"visible",timeout:8000});
    await page.locator("#appliance-category").selectOption("washer");
    await page.locator("#editor input[name=name]").fill("Test washer");
    await page.locator("#editor button[type=submit]").click();
    await page.locator("#editor").waitFor({state:"hidden",timeout:8000});
    await page.getByRole("heading", {name:"Test washer"}).waitFor({state:"visible",timeout:8000});
    await page.getByText("Added to your home").waitFor();
    await page.getByText("Clean washer tub and gasket").first().waitFor({state:"visible",timeout:8000});
    await page.getByRole("button",{name:"Schedule Clean washer tub and gasket"}).click();
    const lastDone = new Date();
    lastDone.setDate(lastDone.getDate()-30);
    const dateValue = [lastDone.getFullYear(),String(lastDone.getMonth()+1).padStart(2,"0"),String(lastDone.getDate()).padStart(2,"0")].join("-");
    await page.locator('#editor input[name="lastDone"]').fill(dateValue);
    await page.locator('#editor button[type="submit"]').click();
    await page.getByRole("button",{name:"Open settings"}).click();
    await page.getByRole("button",{name:"☾ Dark"}).click();
    if (await page.locator("html").getAttribute("data-theme") !== "dark") throw new Error("Dark theme not applied");
    if (await page.locator("#backend-url").isVisible()) throw new Error("Advanced credentials unexpectedly visible");
    await page.getByRole("button",{name:"☀ Light"}).click();
    if (await page.locator("html").getAttribute("data-theme") !== "light") throw new Error("Light theme not restored");
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    const viewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (viewportOverflow) throw new Error("200% type created horizontal page overflow");
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    if (screenshotDir && name === "chromium-mobile") {
      await mkdir(screenshotDir,{recursive:true});
      await page.locator("#toast").waitFor({state:"hidden",timeout:7000});
      await page.screenshot({path:join(screenshotDir,"settings-light.png")});
      await page.getByRole("button",{name:"Shopping list"}).click();
      await page.screenshot({path:join(screenshotDir,"shopping-light.png")});
      await page.getByRole("button",{name:"Today"}).click();
      await page.getByText("Clean washer tub and gasket").first().waitFor();
      await page.screenshot({path:join(screenshotDir,"today-light.png")});
      await page.getByRole("button",{name:"Open settings"}).click();
      await page.getByRole("button",{name:"☾ Dark"}).click();
      await page.getByRole("button",{name:"Today"}).click();
      await page.screenshot({path:join(screenshotDir,"today-dark.png")});
    }
    await page.getByRole("button",{name:"Today"}).click();
    await page.getByRole("button",{name:"Mark Clean washer tub and gasket done"}).click();
    await page.getByText("Maintenance marked complete").waitFor();
    await context.setOffline(true);
    await page.getByText("Offline · saved here").first().waitFor();
    if (screenshotDir && name === "chromium-mobile") {
      await page.getByRole("button",{name:"Open settings"}).click();
      await page.screenshot({path:join(screenshotDir,"settings-offline.png")});
    }
    await context.setOffline(false);
    if (externalRequests.length) throw new Error("Unexpected external requests: "+externalRequests.slice(0,3).join(", "));
    if (pageErrors.length) throw new Error("Browser JS errors before mocked outage: "+pageErrors.join("; "));
    await page.route("https://kept-test.invalid/api/state",route => route.fulfill({
      status:503, contentType:"application/json", body:JSON.stringify({error:"Temporary sync outage"})
    }));
    await page.getByRole("button",{name:"Open settings"}).click();
    await page.locator(".sync-details summary").click();
    await page.locator("#backend-url").fill("https://kept-test.invalid");
    await page.locator("#backend-token").fill("synthetic-test-only");
    await page.locator("#household-passphrase").fill("synthetic-strong-passphrase-only");
    await page.locator("#settings-form button[type=submit]").click();
    await page.getByText("Sync needs attention").first().waitFor({timeout:8000});
    if (screenshotDir && name === "chromium-mobile") {
      await page.screenshot({path:join(screenshotDir,"settings-sync-failed.png")});
    }
    await page.reload({waitUntil:"networkidle",timeout:30000});
    await page.getByRole("button",{name:"Appliances"}).click();
    await page.getByText("Test washer").first().waitFor({state:"visible",timeout:8000});
    await page.getByText("Test washer").first().click();
    await page.getByText("Clean washer tub and gasket").first().waitFor({state:"visible",timeout:8000});
    const unexpectedErrors = pageErrors.filter(message => !message.includes("status of 503 (Service Unavailable)"));
    if(unexpectedErrors.length) throw new Error("Browser JS errors: "+unexpectedErrors.slice(0,6).join("; "));
    console.log("PASS "+name+" "+(isProduction?"production":"local")+" - shopping, appliance, theme, local offline.");
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
