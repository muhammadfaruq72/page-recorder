import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../popup.js", import.meta.url), "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup() {
  const ids = ["controls", "fullscreen", "mobile", "collection", "clear-points", "status", "viewport-size", "point-count", "page-url", "settings"];
  const elements = Object.fromEntries(ids.map(id => [id, { checked: false, disabled: false, textContent: "", dataset: {}, listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; } }]));
  const state = { fullscreen: false, mobile: false, collectionEnabled: false, busy: false, supported: true, active: false, count: 1, url: "https://example.com/" };
  const calls = [];
  let allowPermission = false;
  vm.runInNewContext(source, {
    document: { querySelector: selector => elements[selector.slice(1)] },
    chrome: {
      tabs: { query: async () => [{ id: 42 }] },
      storage: { onChanged: { addListener() {} } },
      permissions: { request: async () => { calls.push({ type: "permission" }); return allowPermission; } },
      runtime: { openOptionsPage: async () => {}, sendMessage: async message => {
        calls.push(structuredClone(message));
        if (message.type === "SET_FULLSCREEN") state.fullscreen = message.enabled;
        if (message.type === "SET_MODE") state.mobile = message.enabled;
        if (message.type === "SET_COLLECTION") state.collectionEnabled = message.enabled;
        if (message.type === "CLEAR_PAGE_POINTS") state.count = 0;
        return { ok: true, state: structuredClone(state) };
      } },
    },
  });
  return { elements, state, calls, allowPermission: () => { allowPermission = true; } };
}

test("popup controls act independently and collection permission is requested before enabling website controls", async () => {
  const h = setup(); await flush();
  assert.equal(h.elements.controls.disabled, false);
  assert.equal(h.calls.some(call => call.type === "SET_FULLSCREEN"), false);
  h.elements.collection.checked = true; h.elements.collection.listeners.change(); await flush();
  assert.equal(h.elements.collection.checked, false);
  assert.equal(h.calls.some(call => call.type === "SET_COLLECTION"), false);
  h.allowPermission();
  h.elements.collection.checked = true; h.elements.collection.listeners.change(); await flush();
  assert.equal(h.elements.collection.checked, true);
  assert.equal(h.state.fullscreen, false);
  h.elements.fullscreen.checked = true; h.elements.fullscreen.listeners.change(); await flush();
  assert.ok(h.calls.some(call => call.type === "SET_FULLSCREEN" && call.enabled && call.tabId === 42));
  h.elements.mobile.checked = true; h.elements.mobile.listeners.change(); await flush();
  assert.ok(h.calls.some(call => call.type === "SET_MODE" && call.enabled));
  h.elements["clear-points"].listeners.click(); await flush();
  assert.ok(h.calls.some(call => call.type === "CLEAR_PAGE_POINTS"));
  assert.equal(h.elements["clear-points"].disabled, true);
  assert.equal(h.elements.fullscreen.checked, true);
});
