import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { scrollPage } from "../smooth-scroll.js";
import { DEFAULT_SCROLL_SETTINGS, SCROLL_SETTINGS_KEY, loadScrollSettings, saveScrollSettings } from "../settings.js";

function element({ height = 3000, viewport = 600, top = 0, rect = { left: 0, top: 0, right: 900, bottom: 600 } } = {}) {
  const styles = new Map([["scroll-behavior", { value: "smooth", priority: "important" }]]);
  const node = {
    scrollHeight: height, clientHeight: viewport, scrollTop: top, scrollLeft: 17, isConnected: true,
    getBoundingClientRect: () => rect,
    style: {
      getPropertyValue: key => styles.get(key)?.value || "",
      getPropertyPriority: key => styles.get(key)?.priority || "",
      setProperty: (key, value, priority = "") => styles.set(key, { value, priority }),
      removeProperty: key => styles.delete(key),
    },
    scrollTo: position => { node.scrollTop = position.top; node.scrollLeft = position.left; },
  };
  return node;
}

function setup({ root = element(), panels = [] } = {}) {
  let time = 0;
  let id = 0;
  const frames = new Map();
  const positions = [];
  const window = new EventTarget();
  window.scrollTo = position => { root.scrollTo(position); positions.push(position.top); };
  const context = vm.createContext({
    window, innerWidth: 900, innerHeight: 600,
    document: { scrollingElement: root, documentElement: root, querySelectorAll: () => panels },
    getComputedStyle: () => ({ overflowY: "auto" }),
    performance: { now: () => time },
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: frame => frames.delete(frame),
  });
  const invoke = command => {
    context.command = command;
    return vm.runInContext(`(${scrollPage.toString()})(command)`, context);
  };
  return {
    root, window, positions, context, frames,
    step(direction = 1, settings = DEFAULT_SCROLL_SETTINGS, sessionId = "one") {
      return invoke({ action: "step", direction, settings, sessionId });
    },
    cancel(sessionId = "one") { return invoke({ action: "cancel", sessionId }); },
    advance(milliseconds, interval = 1000 / 60) {
      const end = time + milliseconds;
      while (time < end) {
        time = Math.min(end, time + interval);
        const callbacks = [...frames.values()];
        frames.clear();
        for (const callback of callbacks) callback(time);
      }
    },
  };
}

test("one press scrolls exactly 30% of the visible page over the selected duration", () => {
  const h = setup();
  h.step();
  h.advance(750);
  assert.ok(Math.abs(h.root.scrollTop - 90) < .001);
  assert.ok(h.frames.size > 0);
  h.advance(750);
  assert.ok(Math.abs(h.root.scrollTop - 180) < .001);
  assert.equal(h.root.scrollLeft, 17);
  assert.equal(h.frames.size, 0);
  assert.equal(h.context.__pageRecorderSmoothScroll, undefined);
});

test("the default motion gently starts and stops with many monotonic intermediate frames", () => {
  const h = setup();
  h.step();
  h.advance(1500);
  assert.ok(h.positions.length >= 80);
  const changes = h.positions.map((value, index) => value - (h.positions[index - 1] || 0));
  assert.ok(changes.every(delta => delta >= 0));
  assert.ok(changes[0] < Math.max(...changes) / 10);
  assert.ok(changes.at(-1) < Math.max(...changes) / 10);
});

test("animation distance and duration are independent of display refresh rate", () => {
  for (const hz of [30, 60, 120, 144]) {
    const h = setup();
    h.step();
    h.advance(1500, 1000 / hz);
    assert.ok(Math.abs(h.root.scrollTop - 180) < .001);
    assert.equal(h.frames.size, 0);
  }
});

test("every rapid press queues a separate step without overlapping animations", () => {
  const h = setup();
  h.step(1);
  h.step(1);
  h.step(-1);
  h.advance(1500);
  assert.ok(Math.abs(h.root.scrollTop - 180) < .001);
  h.advance(1500);
  assert.ok(Math.abs(h.root.scrollTop - 360) < .001);
  h.advance(1500);
  assert.ok(Math.abs(h.root.scrollTop - 180) < .001);
  assert.equal(h.frames.size, 0);
});

test("cancelling stops immediately, drops queued steps, and restores original page styles", () => {
  const h = setup();
  h.step();
  h.step();
  h.advance(500);
  const position = h.root.scrollTop;
  h.cancel();
  h.advance(5000);
  assert.equal(h.root.scrollTop, position);
  assert.equal(h.frames.size, 0);
  assert.equal(h.root.style.getPropertyValue("scroll-behavior"), "smooth");
  assert.equal(h.root.style.getPropertyPriority("scroll-behavior"), "important");
  assert.equal(h.root.style.getPropertyValue("scroll-snap-type"), "");
  assert.equal(h.root.style.getPropertyValue("overflow-anchor"), "");
});

test("an old recording's stop message cannot cancel a newer recording's animation", () => {
  const h = setup();
  h.step(1, DEFAULT_SCROLL_SETTINGS, "new");
  h.cancel("old");
  h.advance(1500);
  assert.ok(Math.abs(h.root.scrollTop - 180) < .001);
});

test("upward and downward steps stop exactly at the page boundaries", () => {
  const root = element({ top: 2380 });
  const h = setup({ root });
  h.step();
  h.advance(1500);
  assert.equal(root.scrollTop, 2400);
  root.scrollTop = 20;
  h.step(-1);
  h.advance(1500);
  assert.equal(root.scrollTop, 0);
  h.step(-1);
  h.advance(20);
  assert.equal(root.scrollTop, 0);
  assert.equal(h.frames.size, 0);
});

test("shrinking page content is clamped and cannot scroll past the new bottom", () => {
  const h = setup();
  h.step();
  h.advance(500);
  h.root.scrollHeight = 700;
  h.advance(1000);
  assert.equal(h.root.scrollTop, 100);
});

test("applications with inner scrolling panels use the largest visible panel", () => {
  const root = element({ height: 600 });
  const sidebar = element({ viewport: 500, rect: { left: 0, top: 0, right: 100, bottom: 500 } });
  const panel = element({ viewport: 600, rect: { left: 100, top: 0, right: 900, bottom: 600 } });
  const h = setup({ root, panels: [sidebar, panel] });
  h.step();
  h.advance(1500);
  assert.ok(Math.abs(panel.scrollTop - 180) < .001);
  assert.equal(sidebar.scrollTop, 0);
  assert.equal(root.scrollTop, 0);
});

test("navigation cancels the current document's animation", () => {
  const h = setup();
  h.step();
  h.advance(500);
  const position = h.root.scrollTop;
  h.window.dispatchEvent(new Event("pagehide"));
  h.advance(1500);
  assert.equal(h.root.scrollTop, position);
  assert.equal(h.frames.size, 0);
});

test("scrolling settings default to disabled, 30%, 1.5 seconds, and extra smooth easing", async () => {
  const preferences = {};
  globalThis.chrome = { storage: { local: {
    get: async () => preferences,
    set: async value => Object.assign(preferences, value),
  } } };
  assert.deepEqual(await loadScrollSettings(), DEFAULT_SCROLL_SETTINGS);
  await saveScrollSettings({ ...DEFAULT_SCROLL_SETTINGS, enabled: true, stepPercent: 45, durationMs: 2000 });
  assert.deepEqual(preferences[SCROLL_SETTINGS_KEY], { ...DEFAULT_SCROLL_SETTINGS, enabled: true, stepPercent: 45, durationMs: 2000 });
  for (const invalid of [{ easing: "bounce" }, { durationMs: 0 }, { durationMs: NaN }, { stepPercent: 101 }, { stepPercent: 0 }, { enabled: "true" }]) {
    await assert.rejects(saveScrollSettings({ ...DEFAULT_SCROLL_SETTINGS, ...invalid }));
  }
});
