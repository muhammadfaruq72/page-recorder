import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../scroll-point-collector.js", import.meta.url), "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(initial = {}) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = { setProperty(name, value) { this[name] = value; } }; this.listeners = {}; this.isConnected = false; this.textContent = ""; this.dataset = {}; }
    connect(value) { this.isConnected = value; this.children.forEach(child => child.connect(value)); this.shadow?.connect(value); }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); child.connect(this.isConnected); } }
    remove() { this.connect(false); if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    attachShadow() { return this.shadow = new Element("shadow"); }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    setAttribute() {}
    click() { if (!this.disabled) this.listeners.click?.({ stopPropagation() {} }); }
  }
  const root = new Element("html"); root.connect(true); root.scrollTop = 543;
  const listeners = new Map(), messages = [];
  const state = { collectionEnabled: true, count: 0, mobile: false, active: true, busy: false, otherActive: false, ...initial };
  const context = vm.createContext({
    document: { documentElement: root, scrollingElement: root, createElement: tag => new Element(tag) },
    window: { addEventListener() {}, removeEventListener() {} },
    chrome: {
      storage: { onChanged: { addListener: fn => listeners.set(fn, fn), removeListener: fn => listeners.delete(fn) } },
      runtime: { sendMessage: async message => {
        messages.push(structuredClone(message));
        if (message.type === "COLLECT_POINT") { state.count++; return { ok: true, count: state.count, top: message.top }; }
        if (message.type === "PAGE_CLEAR_POINTS") state.count = 0;
        if (message.type === "PAGE_SET_MODE") state.mobile = message.enabled;
        return { ok: true, state: structuredClone(state) };
      } },
    },
  });
  const run = () => vm.runInContext(source, context);
  function descendants(element) { return [element, ...element.children.flatMap(descendants), ...(element.shadow ? descendants(element.shadow) : [])]; }
  const buttons = () => descendants(root).filter(element => element.tag === "button" && element.isConnected);
  const changed = async () => { for (const listener of listeners.keys()) listener({ collectScrollPoints: {} }, "local"); await flush(); };
  run();
  return { root, state, messages, context, buttons, changed, run };
}

test("all three website controls remain visible during fullscreen, follow collection, and do not duplicate on reinjection", async () => {
  const h = setup(); await flush();
  assert.deepEqual(h.buttons().map(button => button.textContent), ["Save scroll point", "Clear points", "Switch to mobile"]);
  h.run(); await flush(); assert.equal(h.buttons().length, 3);
  h.state.collectionEnabled = false; await h.changed(); assert.equal(h.buttons().length, 0);
  h.state.collectionEnabled = true; await h.changed(); assert.equal(h.buttons().length, 3);
});
test("website buttons save actual scroll position, clear points and switch the active mode", async () => {
  const h = setup(); await flush();
  h.buttons()[0].click(); await flush();
  assert.ok(h.messages.some(message => message.type === "COLLECT_POINT" && message.top === 543));
  assert.equal(h.buttons()[1].disabled, false);
  h.buttons()[1].click(); await flush();
  assert.ok(h.messages.some(message => message.type === "PAGE_CLEAR_POINTS"));
  assert.equal(h.buttons()[1].disabled, true);
  h.buttons()[2].click(); await flush();
  assert.ok(h.messages.some(message => message.type === "PAGE_SET_MODE" && message.enabled));
  assert.equal(h.buttons()[2].textContent, "Switch to desktop");
});

test("collection controls move inward when the desktop aspect extends beyond the screen", async () => {
  const h = setup({ controlsRightInset: 480 }); await flush();
  assert.equal(h.root.children[0].style.right, "492px");
  assert.equal(h.buttons().length, 3);
});
