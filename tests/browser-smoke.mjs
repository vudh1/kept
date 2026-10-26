/** Real browser smoke test against the running Kept PWA. No network credentials, test state stays in isolated browser context. */
import { chromium, webkit, devices } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const target = process.env.KEPT_TEST_URL || "http://127.0.0.1:4173/";
const isProduction = target.startsWith("https://");
const screenshotDir = process.env.KEPT_SCREENSHOT_DIR;
const configurations = [
  ["chromium-mobile", chromium, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ["chromium-430", chromium, { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true }],
  ["webkit-iphone", webkit, { ...devices["iPhone 13"] }]
];
const selectedBrowser = process.env.KEPT_BROWSER;
// Optional local executable for preinstalled browsers; CI uses Playwright's
// pinned browser revision. Only one browser family should be selected with it.
const executablePath = process.env.KEPT_BROWSER_EXECUTABLE;
async function assertResponsive(page, label) {
  // Browser zoom is not the same as iOS Dynamic Type, but it catches layout
  // overflow that the existing 100% screenshot checks would otherwise miss.
  await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  if (overflow) throw new Error(`200% type created horizontal page overflow on ${label}`);
}
async function assertTouchTarget(page, selector, label) {
  const size = await page.locator(selector).first().boundingBox();
  if (!size || size.width < 44 || size.height < 44) {
    throw new Error(`${label} touch target is smaller than 44 × 44 CSS pixels`);
  }
}
async function assertThemeContrast(page, theme) {
  const failures = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const color = token => {
      let value = css.getPropertyValue(token).trim().replace("#", "");
      if (/^[a-f\d]{3}$/i.test(value)) value = [...value].map(x => x + x).join("");
      if (!/^[a-f\d]{6}$/i.test(value)) throw new Error(`Unexpected color token: ${token}`);
      const channels = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
      return channels.map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    };
    const luminance = token => color(token).reduce((sum, channel, i) => sum + channel * [.2126,.7152,.0722][i], 0);
    return [["--text","--background"],["--muted","--panel-solid"],["--on-accent","--accent"]]
      .map(([foreground, background]) => {
        const [lighter,darker] = [luminance(foreground),luminance(background)].sort((a,b) => b-a);
        return { foreground, background, contrast: (lighter + .05) / (darker + .05) };
      }).filter(pair => pair.contrast < 4.5);
  });
  if (failures.length) throw new Error(`${theme} text contrast below WCAG AA: ${JSON.stringify(failures)}`);
}
let failureCount = 0;
for (const [name, browserType, contextOptions] of configurations) {
  if (selectedBrowser && !name.startsWith(selectedBrowser)) continue;
  const browser = await browserType.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
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
    const tabNames = await page.locator(".tabbar .nav-item span").allTextContents();
    if (tabNames.join("|") !== "Today|Appliances|Shopping|More") throw new Error("Quiet Glass navigation order changed: "+tabNames.join("|"));
    for (const nav of await page.locator(".tabbar .nav-item").all()) {
      if (!await nav.isVisible() || (await nav.boundingBox())?.height < 44) throw new Error("Navigation not reachable by touch");
    }
    await assertResponsive(page, "Today");
    await assertTouchTarget(page, "#quick-add button[type=submit]", "Quick shopping add");
    await assertThemeContrast(page, "light");
    await page.locator("#quick-item").fill("Synthetic oat milk");
    await page.locator("#quick-add button[type=submit]").click();
    await page.getByText("Synthetic oat milk").first().waitFor();
    await page.getByRole("button",{name:"Shopping list"}).click();
    await assertResponsive(page, "Shopping");
    await assertTouchTarget(page, '.shopping-item .check-row', "Shopping check-off");
    await page.getByRole("button",{name:"Check off Synthetic oat milk"}).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button",{name:"Put back Synthetic oat milk"}).waitFor();
    if (await page.evaluate(() => document.activeElement?.getAttribute("aria-label")) !== "Put back Synthetic oat milk") {
      throw new Error("Shopping row lost keyboard focus after check-off re-render");
    }
    await page.reload({waitUntil:"networkidle"});
    await page.getByRole("button",{name:"Shopping list"}).click();
    await page.getByRole("button",{name:"Put back Synthetic oat milk"}).waitFor();
    await page.getByRole("button",{name:"Put back Synthetic oat milk"}).click();
    await page.getByRole("button",{name:"Check off Synthetic oat milk"}).waitFor();
    await page.getByRole("button", {name:"Appliances"}).click();
    await assertResponsive(page, "Appliances");
    await page.getByRole("button", {name:"Add new"}).click();
    await page.locator("#editor").waitFor({state:"visible",timeout:8000});
    await page.keyboard.press("Escape");
    await page.locator("#editor").waitFor({state:"hidden",timeout:8000});
    if (await page.evaluate(() => document.activeElement?.textContent?.trim()) !== "+ Add new") {
      throw new Error("Closing appliance dialog failed to restore opener focus");
    }
    await page.getByRole("button", {name:"Add new"}).click();
    await page.locator("#editor").waitFor({state:"visible",timeout:8000});
    await assertResponsive(page, "Appliance editor");
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
    await page.reload({waitUntil:"networkidle"});
    await page.getByRole("button", {name:"Appliances"}).click();
    await page.getByText("Test washer").first().click();
    await page.getByRole("heading", {name:"Test washer"}).waitFor();
    await page.getByRole("button", {name:"Schedule Clean washer tub and gasket"}).waitFor();
    await page.getByRole("button", {name:"Edit appliance"}).click();
    await page.locator('#editor input[name="name"]').fill("Test washer updated");
    await page.locator('#editor button[type="submit"]').click();
    await page.getByRole("heading", {name:"Test washer updated"}).waitFor();
    await page.reload({waitUntil:"networkidle"});
    await page.getByRole("button", {name:"Appliances"}).click();
    await page.getByText("Test washer updated").first().click();
    await page.getByRole("heading", {name:"Test washer updated"}).waitFor();
    await page.getByRole("button",{name:"More",exact:true}).click();
    await page.getByRole("heading",{name:"Settings"}).waitFor();
    await page.getByRole("button",{name:"Ask Kept"}).click();
    await page.getByRole("heading",{name:"A little extra help."}).waitFor();
    if (await page.locator('.tabbar [data-nav="settings"]').getAttribute("aria-current") !== "page") throw new Error("More tab should remain selected inside optional AI help");
    await page.getByRole("button",{name:"More",exact:true}).click();
    await page.getByRole("button",{name:"☾ Dark"}).click();
    if (await page.locator("html").getAttribute("data-theme") !== "dark") throw new Error("Dark theme not applied");
    await assertThemeContrast(page, "dark");
    await page.reload({waitUntil:"networkidle"});
    await page.getByRole("button",{name:"More",exact:true}).click();
    if (await page.locator("html").getAttribute("data-theme") !== "dark") throw new Error("Dark theme did not persist after refresh");
    if (await page.locator("#backend-url").isVisible()) throw new Error("Advanced credentials unexpectedly visible");
    await page.getByRole("button",{name:"☀ Light"}).click();
    if (await page.locator("html").getAttribute("data-theme") !== "light") throw new Error("Light theme not restored");
    await assertResponsive(page, "More / Settings");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const transitionDuration = await page.locator(".btn").first().evaluate(el => getComputedStyle(el).transitionDuration);
    if (transitionDuration !== "0s") throw new Error("Reduced-motion preference still animates buttons");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    if (screenshotDir && name === "chromium-mobile") {
      await mkdir(screenshotDir,{recursive:true});
      await page.locator("#toast").waitFor({state:"hidden",timeout:7000});
      await page.screenshot({path:join(screenshotDir,"settings-light.png")});
      await page.getByRole("button",{name:"Shopping list"}).click();
      await page.screenshot({path:join(screenshotDir,"shopping-light.png")});
      await page.getByRole("button",{name:"Today"}).click();
      await page.getByText("Clean washer tub and gasket").first().waitFor();
      await page.screenshot({path:join(screenshotDir,"today-light.png")});
      await page.getByRole("button",{name:"More",exact:true}).click();
      await page.getByRole("button",{name:"☾ Dark"}).click();
      await page.getByRole("button",{name:"Today"}).click();
      await page.screenshot({path:join(screenshotDir,"today-dark.png")});
    }
    await page.getByRole("button",{name:"Today"}).click();
    await page.getByRole("button",{name:"Mark Clean washer tub and gasket done"}).click();
    await page.getByText("Maintenance marked complete").waitFor();
    await page.reload({waitUntil:"networkidle"});
    await page.getByRole("button",{name:"Appliances"}).click();
    await page.getByText("Test washer updated").first().click();
    await page.getByText("Recent Activity").waitFor();
    await page.getByText("Completed", {exact:false}).first().waitFor();
    await context.setOffline(true);
    await page.getByText("Offline · saved here").first().waitFor();
    await page.getByRole("button", {name:"Shopping list"}).click();
    await page.locator("#quick-item").fill("Synthetic offline bananas");
    await page.locator("#quick-add button[type=submit]").click();
    await page.getByRole("button", {name:"Check off Synthetic offline bananas"}).waitFor();
    await page.reload({waitUntil:"domcontentloaded"});
    await page.getByRole("button", {name:"Shopping list"}).click();
    await page.getByRole("button", {name:"Check off Synthetic offline bananas"}).waitFor();
    if (screenshotDir && name === "chromium-mobile") {
        await page.getByRole("button",{name:"More",exact:true}).click();
      await page.screenshot({path:join(screenshotDir,"settings-offline.png")});
    }
    await context.setOffline(false);
    if (externalRequests.length) throw new Error("Unexpected external requests: "+externalRequests.slice(0,3).join(", "));
    if (pageErrors.length) throw new Error("Browser JS errors before mocked outage: "+pageErrors.join("; "));
    await context.route("**/api/state",route => route.fulfill({
      status:route.request().method()==="OPTIONS" ? 204 : 503,
      headers:{"access-control-allow-origin":"*","access-control-allow-headers":"X-Kept-Key, Content-Type","access-control-allow-methods":"GET, PUT, OPTIONS"},
      contentType:"application/json",
      body:route.request().method()==="OPTIONS" ? "" : JSON.stringify({error:"Temporary sync outage"})
    }));
    await page.getByRole("button",{name:"More",exact:true}).click();
    await page.locator(".sync-details summary").click();
    await page.locator("#backend-url").fill("http://localhost:4173/mock-sync");
    await page.locator("#backend-token").fill("synthetic-test-only");
    await page.locator("#household-passphrase").fill("synthetic-strong-passphrase-only");
    await page.locator("#settings-form button[type=submit]").click();
    await page.getByText("Sync needs attention").first().waitFor({timeout:8000});
    if (screenshotDir && name === "chromium-mobile") {
      await page.locator("#toast").waitFor({state:"hidden",timeout:7000});
      await page.evaluate(() => window.scrollTo(0,0));
      await page.screenshot({path:join(screenshotDir,"settings-sync-failed.png")});
    }
    await page.reload({waitUntil:"networkidle",timeout:30000});
    await page.getByRole("button",{name:"Appliances"}).click();
    await page.getByText("Test washer updated").first().waitFor({state:"visible",timeout:8000});
    await page.getByText("Test washer updated").first().click();
    await page.getByText("Clean washer tub and gasket").first().waitFor({state:"visible",timeout:8000});
    // A mocked 503 may be reported as a console resource error by Chromium and
    // as a transport error by WebKit when service-worker routing wins. Both are
    // expected after the deliberate outage; app status is asserted above.
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
