/** Node-level event-flow smoke test for the category-first appliance modal. */
import test from "node:test";
import assert from "node:assert/strict";

test("adding a washer opens a modal, saves the device, and renders its tasks", async () => {
  const listeners = new Map();
  const db = new Map();
  const storage = {
    getItem(key) { return db.has(key) ? db.get(key) : null; },
    setItem(key, value) { db.set(key, String(value)); },
    removeItem(key) { db.delete(key); }
  };
  const page = { innerHTML: "" };
  const badge = { textContent: "", classList: { toggle() {} } };
  const toast = { textContent: "", hidden: true };
  const modal = {
    open: false,
    scrollTop: 10,
    attributes: new Map(),
    setAttribute(key,value) { this.attributes.set(key,value); },
    showModal() { this.open = true; },
    close() { this.open = false; },
    focus() { this.focused = true; },
    addEventListener() {},
  };
  const modalContent = { innerHTML: "" };
  const nodes = {
    "#app": page, "#editor": modal, "#toast": toast,
    "#editor-content": modalContent, "#connection-pill": badge
  };
  const dom = {
    documentElement: { dataset: {} },
    querySelector(sel) { return nodes[sel] || null; },
    querySelectorAll() { return []; },
    addEventListener(event, callback) { listeners.set(event, callback); }
  };
  const originals = {
    document: globalThis.document, localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage, navigator: globalThis.navigator,
    window: globalThis.window, location: globalThis.location,
    FormData: globalThis.FormData, setInterval: globalThis.setInterval
  };
  const setGlobal = (name, value) => Object.defineProperty(globalThis,name,{ configurable:true, writable:true,value });
  try {
    setGlobal("document",dom);
    setGlobal("localStorage",storage);
    setGlobal("sessionStorage",storage);
    setGlobal("navigator",{});
    setGlobal("window",{addEventListener(){},scrollTo(){}});
    setGlobal("location",{hash:""});
    setGlobal("setInterval",()=>0);
    setGlobal("FormData",class {
      constructor(form) { this.fields = form.fields; }
      get(name) { return this.fields.get(name) || null; }
      getAll(name) { return this.fields.get(name) || []; }
    });

    await import("../app.js?appliance-modal-smoke-test");
    assert.match(page.innerHTML,/Your home at a glance/);
    assert.match(page.innerHTML,/Needs attention/);
    assert.match(page.innerHTML,/Add to Shopping/);
    const click = listeners.get("click");
    await click({target:{closest(sel) {return sel==="[data-nav]"?{dataset:{nav:"home"}}:null;}}});
    assert.match(page.innerHTML,/Add new/);
    await click({target:{closest(sel) {return sel==="[data-action]"?{dataset:{action:"add-appliance"}}:null;}}});
    assert.equal(modal.open,true);
    assert.equal(modal.focused,true);
    assert.equal(modal.scrollTop,0);
    assert.match(modalContent.innerHTML,/starter-options/);
    assert.match(modalContent.innerHTML,/Suggested maintenance/);
    assert.match(modalContent.innerHTML,/type="checkbox"/);

    const submit = listeners.get("submit");
    await submit({target:{id:{ value: "" }, getAttribute(key) { return key === "id" ? "appliance-form" : null; },fields:new Map([
      ["category","washer"],["name","Laundry washer"],["brand",""],["model",""],
      ["location","Laundry"],["manualUrl",""],["lastDone",""],
      ["id",""],["starterTask",["0","1"]]
    ])},preventDefault(){}});
    assert.equal(modal.open,false);
    assert.match(page.innerHTML,/Laundry washer/);
    assert.match(page.innerHTML,/Added to your home/);
    assert.match(page.innerHTML,/Clean washer tub and gasket/);
    assert.match(page.innerHTML,/Inspect hoses for leaks or damage/);
    const saved=JSON.parse(db.get("kept.household.v1"));
    assert.equal(saved.appliances.length,1);
    assert.equal(saved.tasks.length,2);
    assert.equal(saved.tasks.every(t=>t.lastDone===""),true);
    await click({target:{closest(sel) {return sel==="[data-nav]"?{dataset:{nav:"settings"}}:null;}}});
    assert.match(page.innerHTML,/<details class="advanced-details sync-details">/);
    assert.match(page.innerHTML,/Cloudflare Worker URL/);
    await click({target:{closest(sel) {return sel==="[data-action]"?{dataset:{action:"set-theme",value:"dark"}}:null;}}});
    assert.equal(dom.documentElement.dataset.theme,"dark");
    assert.equal(JSON.parse(db.get("kept.settings.v1")).theme,"dark");
  } finally {
    for(const [name,value] of Object.entries(originals)) setGlobal(name,value);
  }
});
