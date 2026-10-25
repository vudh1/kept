/** Kept PWA: local-first UI, private device storage, opt-in encrypted cloud sync. */
import { CATALOG, catalogItem, GENERAL_REFERENCES } from "./lib/catalog.js";
import { todayLocal, upcomingTasks, status, formatDate, calendarFile } from "./lib/schedules.js";
import { readLocal, writeLocal, blankState, mergeState, touch, uid, SETTINGS_KEY } from "./lib/store.js";
import { syncOnce, researchAppliance, askAssistant } from "./lib/sync.js";

const $ = sel => document.querySelector(sel);
const html = x => String(x ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const app = $("#app");
const editor = $("#editor");
let state = readLocal();
let settings;
try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { settings = {}; }
settings.deviceId ||= uid();
settings.deviceName ||= "My iPhone";
settings.backendUrl ||= "";
localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
let credentials = { token: sessionStorage.getItem("kept.syncToken") || "", passphrase: "" };
let tab = "today";
let selectedAppliance = null;
let shopFilter = "All";
let toastTimeout;
let syncTimer;
let syncBusy = false;
let needsResync = false;
let aiDraft = [];
let chatMessages = [{ type: "assistant", text: "Hi! I can help you understand maintenance and prepare a model-specific checklist. I won't make changes without your approval." }];

function config() { return { baseUrl: settings.backendUrl.trim(), token: credentials.token, passphrase: credentials.passphrase }; }
function canSync() { const c = config(); return Boolean(c.baseUrl && c.token && c.passphrase); }
function save({ sync = true } = {}) {
  writeLocal(state);
  render();
  if (sync) queueSync();
}
function mutate(collection, id, updates) {
  const index = state[collection].findIndex(x => x.id === id);
  if (index < 0) return;
  state[collection][index] = touch({ ...state[collection][index], ...updates }, settings.deviceId);
  save();
}
function add(collection, object) {
  state[collection].push(touch({ id: uid(), ...object }, settings.deviceId));
  save();
}
function notify(text) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { el.hidden = true; }, 3600);
}
function queueSync() {
  if (!canSync()) return;
  needsResync = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => performSync(false), 1250);
}
async function performSync(showToast = true) {
  if (!canSync()) { if (showToast) notify("Open Settings to connect your shared household."); return; }
  if (syncBusy) { needsResync = true; return; }
  syncBusy = true;
  needsResync = false;
  $("#connection-pill").textContent = "Syncing…";
  try {
    const merged = await syncOnce(state, config());
    state = mergeState(state, merged);
    writeLocal(state);
    $("#connection-pill").textContent = "Household synced";
    if (showToast) notify("Synced with your household");
    render();
  } catch (error) {
    $("#connection-pill").textContent = "Sync needs attention";
    if (showToast) notify(error.message);
    console.warn("Kept sync could not complete:", error.message);
  } finally {
    syncBusy = false;
    if (needsResync) queueSync();
  }
}
function visibleAppliances() { return state.appliances.filter(a => !a.deleted); }
function visibleShopping() { return state.shopping.filter(x => !x.deleted); }
function taskCount() { return upcomingTasks(state).filter(t => ["overdue","due","soon"].includes(t.due.kind)).length; }
function taskCard(task) {
  const a = visibleAppliances().find(x => x.id === task.applianceId);
  return `<div class="card glass"><div class="card-row"><div class="icon-tile">${iconFor(a?.category)}</div><div class="card-main"><div class="card-title">${html(task.title)}</div><div class="card-description">${html(a?.name || "Home")} · ${html(formatDate(task.due.date))}</div></div><span class="pill ${task.due.kind}">${html(task.due.label)}</span></div><div class="action-row"><button class="btn small secondary" data-action="complete" data-id="${html(task.id)}">Mark done</button><button class="btn small secondary" data-action="edit-task" data-id="${html(task.id)}">Edit schedule</button></div></div>`;
}
function iconFor(category) {
  const map = { dishwasher:"◈",refrigerator:"▣",washer:"◉",dryer:"✺",hvac:"❋","water-heater":"♨",irrigation:"◌","smoke-alarm":"◇","air-purifier":"✳",vacuum:"✧",range:"♨","coffee-maker":"☕","range-hood":"≋","garage-door":"▤","water-filter":"◍",microwave:"▧",freezer:"❄","garbage-disposal":"♻","toaster-oven":"♨","electric-kettle":"♨","robot-vacuum":"◎",humidifier:"◌",dehumidifier:"◍","bathroom-fan":"✺","ceiling-fan":"✺","sump-pump":"◈","water-softener":"◍",thermostat:"◉","security-camera":"◇","window-ac":"❄","leak-sensor":"◈",other:"⌂" };
  return map[category] || "⌂";
}
function empty(title, detail, action, label) {
  return `<div class="empty card glass"><div class="empty-icon">✦</div><h3>${html(title)}</h3><p>${html(detail)}</p>${action ? `<button class="btn secondary small" data-action="${html(action)}">${html(label)}</button>` : ""}</div>`;
}
function renderToday() {
  const all = upcomingTasks(state);
  const important = all.filter(t => ["overdue","due","soon"].includes(t.due.kind));
  const needsDates = all.filter(t => t.due.kind === "unscheduled").length;
  const open = visibleShopping().filter(i => !i.done);
  const hour = new Date().getHours();
  const greeting = hour < 11 ? "Good morning." : hour < 17 ? "Good afternoon." : "Good evening.";
  const day = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return `<section class="hero"><p class="eyebrow">${html(day)}</p><h1>${greeting}</h1><p class="subtitle">Little things, taken care of. Here's what your home needs next.</p></section>
    <div class="grid-two"><div class="metric glass"><div class="metric-icon">⌂</div><div class="metric-number">${important.length}</div><div class="metric-caption">Maintenance due soon</div></div><div class="metric glass"><div class="metric-icon">♧</div><div class="metric-number">${open.length}</div><div class="metric-caption">Things to pick up</div></div></div>
    <section class="section"><div class="section-head"><h2>Up next</h2><button class="link-button" data-nav="home">View home →</button></div>
    ${important.length ? important.slice(0, 4).map(taskCard).join("") : empty("You're all caught up",all.length ? "No maintenance is due in the next 14 days." : "Add an appliance to build your maintenance schedule.","add-appliance","Add an appliance")}</section>
    ${needsDates ? `<p class="form-tip">${needsDates} maintenance schedule${needsDates===1?" needs":"s need"} a last-serviced date. Add one whenever you know it — no invented due dates.</p>` : ""}
    <section class="section"><div class="section-head"><h2>Shopping preview</h2><button class="link-button" data-nav="shop">Open list →</button></div>
    <div class="card glass">${open.length ? open.slice(0, 4).map(item => `<button class="check-row" data-action="toggle-item" data-id="${html(item.id)}"><span class="check-circle"></span><span class="check-content"><span class="check-title">${html(item.name)}</span><div class="check-subtitle">${html([item.quantity,item.store].filter(Boolean).join(" · "))}</div></span></button>`).join("") : `<p class="muted">Nothing on your shopping list right now.</p>`}</div></section>`;
}
function renderHome() {
  const appliances = visibleAppliances();
  if (selectedAppliance && !appliances.some(x => x.id === selectedAppliance)) selectedAppliance = null;
  if (selectedAppliance) return renderApplianceDetail(appliances.find(x => x.id === selectedAppliance));
  return `<section class="hero"><p class="eyebrow">Your home</p><h1>Everything in place.</h1><p class="subtitle">Appliances, maintenance plans, and a clear history of what's been done.</p></section>
    <section class="section" style="margin-top:10px"><div class="section-head"><h2>${appliances.length} appliances</h2><button class="btn small" data-action="add-appliance">+ Add new</button></div>
    ${appliances.length ? appliances.map(a => { const tasks = state.tasks.filter(t => t.applianceId === a.id && !t.deleted); const next = tasks.map(t => status(t)).sort((x,y) => (x.date || "9999").localeCompare(y.date || "9999"))[0]; return `<button class="card glass" style="width:100%;color:inherit;text-align:left" data-action="view-appliance" data-id="${html(a.id)}"><div class="card-row"><div class="icon-tile">${iconFor(a.category)}</div><div class="card-main"><div class="card-title">${html(a.name)}</div><div class="card-description">${html([a.brand,a.model,a.location].filter(Boolean).join(" · ") || catalogItem(a.category).name)}</div></div>${next ? `<span class="pill ${next.kind}">${html(next.label)}</span>` : `<span class="chevron">›</span>`}</div></button>`; }).join("") : empty("Start with one appliance", "Choose a type for ready-made common maintenance tasks. Brand and model are optional.","add-appliance","Add your first appliance")}</section>`;
}
function renderApplianceDetail(a) {
  const tasks = state.tasks.filter(t => t.applianceId === a.id && !t.deleted).sort((x,y) => (status(x).date || "9999").localeCompare(status(y).date || "9999"));
  const events = state.history.filter(h => !h.deleted && tasks.some(t => t.id === h.taskId)).sort((x,y)=>y.completedAt.localeCompare(x.completedAt)).slice(0,5);
  return `<section class="hero"><button class="link-button" data-action="back-home" style="padding-left:0">‹ All appliances</button><div class="card-row" style="margin-top:10px"><div class="icon-tile" style="height:57px;width:57px;font-size:1.6rem">${iconFor(a.category)}</div><div class="card-main"><h1 style="font-size:2rem;margin:0">${html(a.name)}</h1><p class="muted">${html([a.brand,a.model,a.location].filter(Boolean).join(" · ") || catalogItem(a.category).name)}</p></div></div></section>
    <div class="action-row"><button class="btn small secondary" data-action="edit-appliance" data-id="${html(a.id)}">Edit appliance</button><button class="btn small secondary" data-nav="assist" data-select="${html(a.id)}">✦ Ask AI</button></div>
    <section class="section"><div class="section-head"><h2>Maintenance plan</h2><button class="link-button" data-action="add-task" data-id="${html(a.id)}">+ Task</button></div>${tasks.length ? tasks.map(taskCard).join("") : empty("No maintenance tasks", "Add a recurring task or ask AI to create a draft.","add-task","Add maintenance")}</section>
    <section class="section"><div class="section-head"><h2>Recent activity</h2></div><div class="card glass">${events.length ? events.map(e=>`<div class="check-row" style="cursor:default"><span class="check-circle" style="background:#5dcda7">✓</span><span class="check-content"><span class="check-title">${html(e.title)}</span><span class="check-subtitle">Completed ${html(formatDate(e.completedAt))}</span></span></div>`).join("") : `<p class="muted">No completed maintenance yet.</p>`}</div></section>
    <section class="section"><button class="btn small danger" data-action="delete-appliance" data-id="${html(a.id)}">Remove appliance</button></section>`;
}
function renderShop() {
  const items = visibleShopping();
  const options = ["All", ...new Set(items.map(x => x.store).filter(Boolean))];
  if (!options.includes(shopFilter)) shopFilter="All";
  const filtered = items.filter(x => shopFilter === "All" || x.store === shopFilter).sort((x,y)=>Number(x.done)-Number(y.done));
  const pending = items.filter(x => !x.done).length;
  return `<section class="hero"><p class="eyebrow">Shared shopping</p><h1>The list, together.</h1><p class="subtitle">Add something here and it appears on both devices once household sync is connected.</p></section>
    <form id="quick-add" class="inline-form" autocomplete="off"><input class="input" name="name" placeholder="Add milk, paper towels…" maxlength="120" required aria-label="Shopping item"><button class="btn" type="submit">Add +</button></form>
    <div class="section-head" style="margin-top:25px"><h2>${pending} to pick up</h2><button class="link-button" data-action="shop-options">Item details +</button></div>
    <div class="store-chips">${options.map(s => `<button class="chip ${s===shopFilter?"active":""}" data-action="shop-filter" data-value="${html(s)}">${html(s)}</button>`).join("")}</div>
    <div class="card glass">${filtered.length ? filtered.map(item => `<div class="card-row" style="border-bottom:1px solid var(--stroke)"><button class="check-row ${item.done ? "done" : ""}" style="flex:1;border:0" data-action="toggle-item" data-id="${html(item.id)}"><span class="check-circle">${item.done ? "✓" : ""}</span><span class="check-content"><span class="check-title">${html(item.name)}</span><div class="check-subtitle">${html([item.quantity,item.store].filter(Boolean).join(" · ") || "Any store")}</div></span></button><button class="round-button" data-action="edit-item" data-id="${html(item.id)}" aria-label="Edit ${html(item.name)}" style="width:32px;height:32px">···</button></div>`).join("") : `<div class="empty"><div class="empty-icon">♧</div><h3>All clear</h3><p>${shopFilter==="All" ? "Your list is empty. Add an item to get started." : "No items for this store."}</p></div>`}</div>
    <div class="action-row"><button class="btn secondary small" data-action="clear-purchased">Clear purchased</button></div>`;
}
function renderAssist() {
  const appliances = visibleAppliances();
  const a = appliances.find(x=>x.id===selectedAppliance) || appliances[0];
  return `<section class="hero"><p class="eyebrow">Kept intelligence</p><h1>A little extra help.</h1><p class="subtitle">Start with included maintenance suggestions. For optional model-specific guidance, research a manual or ask a question.</p></section>
    <section class="card glass"><div class="section-head"><h2>Research an appliance</h2><span class="pill">Gemini</span></div>
    <p class="form-tip">Requires your own Gemini API key on the Worker. A public manual URL is required; results are always drafts pending your review.</p>
    ${!appliances.length ? `<div class="note">First add an appliance on the Home tab.</div>` : `<form id="research-form"><div class="field"><label for="research-appliance">Appliance</label><select id="research-appliance" name="appliance" required>${appliances.map(x=>`<option value="${html(x.id)}" ${x.id===a?.id?"selected":""}>${html(x.name)} ${html(x.model || "")}</option>`).join("")}</select></div><div class="field"><label for="research-url">Official manual URL (HTTPS)</label><input id="research-url" class="input" type="url" name="manualUrl" value="${html(a?.manualUrl || "")}" placeholder="https://manufacturer.com/manual.pdf" required></div><button class="btn full" type="submit">✦ Research maintenance</button></form>`}
    ${aiDraft.length ? `<div class="soft-divider"></div><h3>Review AI suggestions</h3><p class="form-tip">AI drafts are not verified. Check intervals against your manual before adding.</p><div class="stack">${aiDraft.map((t,i)=>`<div class="note"><strong>${html(t.title)}</strong><br>${html(t.intervalDays || "?")} days · ${html(t.instructions || "")}<br><em>Source excerpt: ${html(t.evidence || "none")}</em></div>`).join("")}</div><div class="action-row"><button class="btn" data-action="accept-ai">Add reviewed tasks</button><button class="btn secondary" data-action="discard-ai">Discard</button></div>` : ""}</section>
    <section class="section"><div class="section-head"><h2>Ask Kept</h2><span class="pill">Groq</span></div><div class="card glass"><div class="chat-window" id="chat-window">${chatMessages.map(m=>`<div class="bubble ${m.type}">${html(m.text)}</div>`).join("")}</div><div class="soft-divider"></div><form id="chat-form" class="inline-form"><input class="input" name="message" maxlength="700" placeholder="Ask a home maintenance question" required aria-label="Ask Kept AI"><button class="btn" type="submit">Send</button></form><p class="form-tip">Only your question and selected appliance type/model are sent to Groq, not your shopping list or household history.</p></div></section>`;
}
function renderSettings() {
  return `<section class="hero"><p class="eyebrow">Preferences</p><h1>Make it yours.</h1><p class="subtitle">Your device works offline. Connect a Cloudflare Worker for encrypted two-person sync.</p></section>
    <section class="card glass"><h2>Household connection</h2><p class="form-tip">Your passphrase encrypts data on this iPhone before it goes to the publicly readable encrypted GitHub branch. The backend never receives it. Keep the same passphrase on both devices.</p>
    <form id="settings-form"><div class="field"><label for="device-name">Device name</label><input class="input" name="deviceName" id="device-name" value="${html(settings.deviceName)}" maxlength="40" required></div>
    <div class="field"><label for="backend-url">Cloudflare Worker URL</label><input class="input" type="url" name="backendUrl" id="backend-url" value="${html(settings.backendUrl)}" placeholder="https://kept-sync.example.workers.dev"></div>
    <div class="field"><label for="backend-token">Shared access key (this session only)</label><input class="input" type="password" name="token" id="backend-token" value="${html(credentials.token)}" placeholder="Worker SYNC_TOKEN" autocomplete="off"></div>
    <div class="field"><label for="household-passphrase">Household encryption passphrase (never sent)</label><input class="input" type="password" name="passphrase" id="household-passphrase" placeholder="12+ characters" autocomplete="off" minlength="12"></div>
    <p class="form-tip">The passphrase is held in memory only and must be reentered after the app restarts. Losing it means encrypted cloud history cannot be recovered.</p>
    <button class="btn full" type="submit">Save & sync now</button></form><div class="action-row"><button class="btn secondary small" data-action="sync">Sync again</button><button class="btn secondary small" data-action="disconnect">Lock this device</button></div></section>
    <section class="section card glass"><h2>Reminders & backup</h2><p class="form-tip">Due dates are shown inside Kept. Native background push delivery isn't active in this version; you can export the next occurrences to iPhone Calendar with one-day alerts.</p><div class="action-row"><button class="btn small secondary" data-action="export-calendar">Export calendar alerts</button><button class="btn small secondary" data-action="export-backup">Export JSON backup</button></div></section>
    <section class="section card glass"><h2>Privacy first</h2><p class="audit">Local-only mode stores data in this browser's storage. Shared mode uploads only AES-GCM ciphertext to your public GitHub runtime-state branch through your Worker. A device with the shared passphrase can decrypt it. AI research and chat are opt-in and only send the details shown on the AI screen. Avoid including sensitive personal information in AI prompts.</p></section>
    <section class="section"><button class="btn danger small" data-action="clear-local">Erase local device data</button></section>`;
}
function render() {
  app.innerHTML = tab === "today" ? renderToday() : tab === "home" ? renderHome() : tab === "shop" ? renderShop() : tab === "assist" ? renderAssist() : renderSettings();
  document.querySelectorAll("[data-nav]").forEach(b => b.classList.toggle("active", b.dataset.nav === tab));
  const badge = $("#connection-pill");
  if (!syncBusy && !canSync()) badge.textContent = settings.backendUrl ? "Locked · local" : "On this device";
  if ("setAppBadge" in navigator) navigator.setAppBadge(taskCount()).catch(()=>{});
}
function openModal(content) {
  $("#editor-content").innerHTML = content;
  editor.showModal();
  editor.querySelector("input:not([type=hidden]),select")?.focus();
}
function formActions() { return `<div class="form-actions"><button class="btn secondary" type="button" data-action="close-modal">Cancel</button><button class="btn" type="submit">Save</button></div>`; }
function starterOptions(category) {
  const def = catalogItem(category);
  if (!def.tasks.length) return `<p class="form-tip">No common templates for this type. You can add your own tasks later.</p>`;
  return `<fieldset class="starter-picker"><legend>Suggested maintenance · select what applies</legend><p class="form-tip">General guidance, not verified for your model. All tasks and intervals are editable.</p>${def.tasks.map((t,i) => `<label class="starter-task"><input type="checkbox" name="starterTask" value="${i}" checked><span><strong>${html(t.title)}</strong><small>Suggested check every ${t.days} days</small></span></label>`).join("")}</fieldset>`;
}
function applianceModal(a) {
  const item = a || {};
  openModal(`<h2>${a?"Edit":"Add"} appliance</h2><p class="modal-intro">Choose a type and Kept suggests common maintenance. No model number needed.</p><form id="appliance-form"><input type="hidden" name="id" value="${html(item.id || "")}">
    <div class="field"><label>Appliance type</label><select name="category" id="appliance-category" required>${CATALOG.map(c=>`<option value="${c.id}" ${item.category===c.id?"selected":""}>${html(c.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Nickname</label><input class="input" name="name" placeholder="Kitchen dishwasher" maxlength="80" value="${html(item.name || "")}"></div>
    <details class="advanced-details" ${a ? "open" : ""}><summary>Brand, model & manual (optional)</summary><div class="two-inputs"><div class="field"><label>Brand</label><input class="input" name="brand" maxlength="60" placeholder="KitchenAid" value="${html(item.brand || "")}"></div><div class="field"><label>Model</label><input class="input" name="model" maxlength="100" placeholder="Model number" value="${html(item.model || "")}"></div></div>
    <div class="field"><label>Room / location</label><input class="input" name="location" maxlength="60" placeholder="Kitchen" value="${html(item.location || "")}"></div>
    <div class="field"><label>Official manual URL (optional)</label><input type="url" class="input" name="manualUrl" placeholder="https://..." value="${html(item.manualUrl || "")}"></div></details>
    ${a ? "" : `<div class="field"><label>Last maintained (optional, for a first due date)</label><input class="input" type="date" name="lastDone" max="${todayLocal()}" value=""></div><p class="form-tip">Leave blank if you do not know. Kept will not invent a due date.</p><div id="starter-options">${starterOptions(item.category || CATALOG[0].id)}</div>`}
    ${formActions()}</form>`);
}
function taskModal(task, applianceId) {
  const t = task || {};
  const appliances = visibleAppliances();
  openModal(`<h2>${task ? "Edit" : "New"} maintenance task</h2><p class="modal-intro">Keep every recurring task simple and clear.</p><form id="task-form"><input type="hidden" name="id" value="${html(t.id || "")}"><div class="field"><label>Appliance</label><select name="applianceId" required>${appliances.map(a=>`<option value="${html(a.id)}" ${(t.applianceId || applianceId) === a.id ? "selected":""}>${html(a.name)}</option>`).join("")}</select></div><div class="field"><label>Maintenance task</label><input class="input" name="title" maxlength="120" value="${html(t.title || "")}" placeholder="Replace water filter" required></div><div class="two-inputs"><div class="field"><label>Repeat every (days)</label><input class="input" name="intervalDays" type="number" min="1" max="3650" value="${html(t.intervalDays || 30)}" required></div><div class="field"><label>Last performed</label><input class="input" name="lastDone" type="date" value="${html(t.lastDone || "")}" max="${todayLocal()}"></div></div><div class="field"><label>Instructions / notes</label><textarea name="instructions" maxlength="1000">${html(t.instructions || "")}</textarea></div>${/^https:\/\//i.test(t.sourceUrl || "") ? `<p class="form-tip">General reference (verify for your model): <a href="${html(t.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open guidance ↗</a></p>` : ""}${formActions()}</form>${task ? `<button class="btn danger small" data-action="delete-task" data-id="${html(t.id)}">Remove this task</button>` : ""}`);
}
function itemModal(item) {
  const i = item || {};
  openModal(`<h2>${item ? "Edit" : "Add"} shopping item</h2><form id="item-form"><input type="hidden" name="id" value="${html(i.id || "")}"><div class="field"><label>Item</label><input class="input" name="name" maxlength="120" value="${html(i.name || "")}" placeholder="Paper towels" required></div><div class="two-inputs"><div class="field"><label>Quantity / size</label><input class="input" name="quantity" maxlength="60" value="${html(i.quantity || "")}" placeholder="1 pack"></div><div class="field"><label>Preferred store</label><input class="input" name="store" maxlength="60" value="${html(i.store || "")}" placeholder="Costco"></div></div><div class="field"><label>Extra notes</label><textarea name="notes" maxlength="300">${html(i.notes || "")}</textarea></div>${formActions()}</form>${item ? `<button class="btn danger small" data-action="delete-item" data-id="${html(i.id)}">Remove item</button>` : ""}`);
}
function completeTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t || t.deleted) return;
  const completedAt = todayLocal();
  state.history.push(touch({ id: uid(), taskId: id, title: t.title, completedAt }, settings.deviceId));
  state.tasks[state.tasks.indexOf(t)] = touch({ ...t, lastDone: completedAt }, settings.deviceId);
  save();
  notify("Maintenance marked complete ✓");
}
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Event delegation keeps screens simple, works after every re-render.
document.addEventListener("click", async event => {
  const nav = event.target.closest("[data-nav]");
  if (nav) { tab = nav.dataset.nav; if (nav.dataset.select) selectedAppliance = nav.dataset.select; window.scrollTo({top:0,behavior:"smooth"}); render(); return; }
  const btn = event.target.closest("[data-action]");
  if (!btn) return;
  const { action, id, value } = btn.dataset;
  switch (action) {
    case "add-appliance": applianceModal(); break;
    case "edit-appliance": applianceModal(state.appliances.find(x=>x.id===id)); break;
    case "view-appliance": selectedAppliance=id; tab="home"; render(); break;
    case "back-home": selectedAppliance=null; render(); break;
    case "delete-appliance": if (confirm("Remove this appliance and its tasks from your household?")) { mutate("appliances",id,{deleted:true}); selectedAppliance=null; editor.close(); render(); } break;
    case "add-task": if (visibleAppliances().length) taskModal(null,id || selectedAppliance); else notify("Add an appliance first."); break;
    case "edit-task": taskModal(state.tasks.find(x=>x.id===id)); break;
    case "delete-task": if (confirm("Remove this maintenance task?")) { mutate("tasks",id,{deleted:true}); editor.close(); } break;
    case "complete": completeTask(id); break;
    case "shop-options": itemModal(); break;
    case "edit-item": itemModal(state.shopping.find(x=>x.id===id)); break;
    case "delete-item": mutate("shopping",id,{deleted:true}); editor.close(); break;
    case "toggle-item": { const i=state.shopping.find(x=>x.id===id); if(i) mutate("shopping",id,{done:!i.done}); break; }
    case "shop-filter": shopFilter=value; render(); break;
    case "clear-purchased": { const completed=visibleShopping().filter(x=>x.done); if (!completed.length) return notify("No purchased items to clear."); if(confirm(`Remove ${completed.length} purchased items?`)) { for (const i of completed) state.shopping[state.shopping.indexOf(i)] = touch({...i,deleted:true}, settings.deviceId); save(); } break; }
    case "close-modal": editor.close(); break;
    case "sync": await performSync(); break;
    case "disconnect": credentials={ token:"",passphrase:"" }; sessionStorage.removeItem("kept.syncToken"); render(); notify("Cloud sync locked for this session"); break;
    case "export-calendar": { const tasks=upcomingTasks(state); download("kept-maintenance.ics",calendarFile(tasks,visibleAppliances()),"text/calendar;charset=utf-8"); notify("Calendar export ready. Import it into your iPhone calendar."); break; }
    case "export-backup": download(`kept-backup-${todayLocal()}.json`,JSON.stringify(state,null,2),"application/json"); notify("Backup exported — store it securely. It contains unencrypted data."); break;
    case "clear-local": if (confirm("Permanently erase this device's Kept records? Your encrypted GitHub copy will remain untouched.")) { state=blankState(); writeLocal(state); selectedAppliance=null; render(); notify("Local data erased"); } break;
    case "accept-ai": {
      const appliance = state.appliances.find(x=>x.id===selectedAppliance) || visibleAppliances()[0];
      if (!appliance || !aiDraft.length) break;
      const duplicateNames = new Set(state.tasks.filter(t=>!t.deleted&&t.applianceId===appliance.id).map(t=>t.title.toLowerCase()));
      let added=0;
      for (const t of aiDraft) if (!duplicateNames.has(t.title.toLowerCase())) { state.tasks.push(touch({id:uid(),applianceId:appliance.id,title:t.title,intervalDays:t.intervalDays,lastDone:"",instructions:`${t.instructions} Evidence from AI draft: ${t.evidence || "not provided"}`,sourceUrl:t.sourceUrl,sourceType:"ai-draft"},settings.deviceId));added++; }
      aiDraft=[];save();notify(`Added ${added} AI drafts. Review their dates and instructions.`);break;
    }
    case "discard-ai": aiDraft=[];render();break;
  }
});
document.addEventListener("change", event => {
  if (event.target.id === "appliance-category") {
    const list = document.querySelector("#starter-options");
    if (list) list.innerHTML = starterOptions(event.target.value);
  }
});
document.addEventListener("submit", async event => {
  const form=event.target;
  if (!["quick-add","appliance-form","task-form","item-form","settings-form","research-form","chat-form"].includes(form.id)) return;
  event.preventDefault();
  const f=new FormData(form), s=key=>String(f.get(key)||"").trim();
  if (form.id==="quick-add") { if (s("name")) add("shopping",{name:s("name"),quantity:"",store:"",notes:"",done:false}); form.reset(); }
  if (form.id==="appliance-form") {
    const category=s("category"), def=catalogItem(category);
    const attrs={category,name:s("name")||def.name,brand:s("brand"),model:s("model"),location:s("location")||def.location,manualUrl:s("manualUrl")};
    const id=s("id");
    if(id) mutate("appliances",id,attrs);
    else {
      const applianceId=uid();
      state.appliances.push(touch({id:applianceId,...attrs},settings.deviceId));
      const enabled = new Set(f.getAll("starterTask").map(Number));
      for(const [i,t] of def.tasks.entries()) if(enabled.has(i)) state.tasks.push(touch({id:uid(),applianceId,title:t.title,intervalDays:t.days,lastDone:s("lastDone"),instructions:t.notes,sourceType:"starter",sourceUrl:t.sourceUrl || GENERAL_REFERENCES[category] || ""},settings.deviceId));
      selectedAppliance=applianceId;
    }
    tab="home";editor.close();save();notify(id?"Appliance updated":"Appliance and starter tasks added");
  }
  if(form.id==="task-form") {
    const attrs={applianceId:s("applianceId"),title:s("title"),intervalDays:Number(s("intervalDays")),lastDone:s("lastDone"),instructions:s("instructions")};
    if(!Number.isInteger(attrs.intervalDays)||attrs.intervalDays<1||attrs.intervalDays>3650) return notify("Choose an interval of 1 to 3650 days.");
    if(s("id")) mutate("tasks",s("id"),attrs); else add("tasks",{...attrs,sourceType:"custom",sourceUrl:""});
    editor.close();notify("Maintenance schedule saved");
  }
  if(form.id==="item-form") {
    const attrs={name:s("name"),quantity:s("quantity"),store:s("store"),notes:s("notes")};
    if(s("id")) mutate("shopping",s("id"),attrs); else add("shopping",{...attrs,done:false});
    editor.close();notify("Shopping item saved");
  }
  if(form.id==="settings-form") {
    settings.deviceName=s("deviceName")||"My iPhone";
    settings.backendUrl=s("backendUrl").replace(/\/$/,"");
    if(settings.backendUrl && !settings.backendUrl.startsWith("https://") && !settings.backendUrl.startsWith("http://localhost")) return notify("Cloud backend must use HTTPS.");
    localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));
    credentials.token=s("token");
    if(s("passphrase")) credentials.passphrase=s("passphrase");
    if(credentials.token) sessionStorage.setItem("kept.syncToken",credentials.token);
    render();await performSync();
  }
  if(form.id==="research-form") {
    if(!canSync()) return notify("Connect the Worker and unlock the household in Settings first.");
    const a=visibleAppliances().find(x=>x.id===s("appliance"));
    if(!a) return;
    selectedAppliance=a.id;
    const submit=form.querySelector('button[type="submit"]');submit.disabled=true;submit.textContent="Researching…";
    try {
      const result=await researchAppliance(config(),{category:catalogItem(a.category).name,brand:a.brand,model:a.model,manualUrl:s("manualUrl")});
      aiDraft=(result.tasks||[]).filter(t=>typeof t.title==="string"&&Number.isInteger(Number(t.intervalDays))&&Number(t.intervalDays)>=1&&Number(t.intervalDays)<=3650).map(t=>({title:t.title.slice(0,120),intervalDays:Number(t.intervalDays),instructions:String(t.instructions||"").slice(0,700),evidence:String(t.evidence||"").slice(0,200),sourceUrl:s("manualUrl")})).slice(0,12);
      if(!aiDraft.length) notify("No defensible maintenance intervals were found. Try another official manual.");
      render();
    } catch(err) { notify(err.message); } finally {submit.disabled=false;submit.textContent="✦ Research maintenance";}
  }
  if(form.id==="chat-form") {
    const message=s("message");if(!message) return;
    const a=visibleAppliances().find(x=>x.id===selectedAppliance)||visibleAppliances()[0];
    chatMessages.push({type:"user",text:message});
    chatMessages.push({type:"assistant",text:"Thinking…"});render();
    try { const r=await askAssistant(config(),message,a?{category:catalogItem(a.category).name,brand:a.brand,model:a.model}:null); chatMessages[chatMessages.length-1].text=String(r.answer||"No response."); }
    catch(err) {chatMessages[chatMessages.length-1].text=`AI unavailable: ${err.message}`;}
    render();$("#chat-window")?.scrollTo(0,10000);
  }
});
editor.addEventListener("click",event=>{if(event.target===editor)editor.close();});
window.addEventListener("hashchange",()=>{const value=location.hash.slice(1);if(["today","home","shop","assist","settings"].includes(value)){tab=value;render();}});
document.addEventListener("visibilitychange",()=>{if(!document.hidden && canSync())performSync(false);});
if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
setInterval(()=>{if(!document.hidden && canSync()) performSync(false);},60000);
render();
if(canSync())performSync(false);
