import test from "node:test";
import assert from "node:assert/strict";
import { WINDOW_WIDTH_KEY, LEGACY_WINDOW_SIZE_KEY, loadWindowWidth, saveWindowWidth, validateWindowWidth } from "../settings.js";
import { prepareRecordingWindow, selectRecordingDisplay } from "../window-size.js";

const tab = { id: 42, windowId: 9 };
const immediate = { pause: async () => {}, attempts: 5 };

function setup({ width = 960, state = "normal", clamp = false } = {}) {
  const preferences = width != null ? { [WINDOW_WIDTH_KEY]: width } : {};
  const window = { id: 9, width: 1280, height: 900, left: 80, top: 100, state };
  const displays = [{
    id: "primary", isEnabled: true,
    bounds: { left: 0, top: 0, width: 1920, height: 1080 },
    workArea: { left: 0, top: 30, width: 1920, height: 1020 },
  }];
  const updates = [];
  const writes = [];
  globalThis.chrome = {
    storage: { local: {
      get: async () => structuredClone(preferences),
      set: async values => { writes.push(structuredClone(values)); Object.assign(preferences, structuredClone(values)); },
      remove: async key => { delete preferences[key]; },
    } },
    system: { display: { getInfo: async () => structuredClone(displays) } },
    windows: {
      get: async id => { assert.equal(id, 9); return { ...window }; },
      update: async (id, values) => {
        assert.equal(id, 9);
        updates.push({ ...values });
        if (!clamp || !values.width) Object.assign(window, values);
        return { ...window };
      },
    },
    tabs: { get: async id => {
      assert.equal(id, 42);
      return { id, windowId: 9, width: window.width - 16, height: window.height - 100 };
    } },
  };
  return { window, displays, preferences, updates, writes };
}

test("only the width is saved persistently across worker reloads", async () => {
  const h = setup({ width: null });
  assert.equal(await loadWindowWidth(), null);
  await saveWindowWidth(1200);
  const reloaded = await import("../settings.js?new-worker");
  assert.equal(await reloaded.loadWindowWidth(), 1200);
  assert.deepEqual(h.preferences, { [WINDOW_WIDTH_KEY]: 1200 });
});

test("upgrading preserves the existing width and discards the old height", async () => {
  const h = setup({ width: null });
  h.preferences[LEGACY_WINDOW_SIZE_KEY] = { width: 1200, height: "ignored old height" };
  assert.equal(await loadWindowWidth(), 1200);
  assert.deepEqual(h.preferences, { [WINDOW_WIDTH_KEY]: 1200 });
});

test("invalid widths cannot replace the saved width", async () => {
  const h = setup();
  for (const width of [-1, 960.5, NaN, "960", 20000, undefined]) {
    await assert.rejects(saveWindowWidth(width), /whole-number width/);
  }
  assert.equal(h.writes.length, 0);
  assert.equal(await loadWindowWidth(), 960);
  assert.equal(validateWindowWidth(1200), 1200);
});

test("the first recording remembers the current width once and never saves height", async () => {
  const h = setup({ width: null });
  await prepareRecordingWindow(tab, immediate);
  assert.deepEqual(h.preferences, { [WINDOW_WIDTH_KEY]: 1280 });
  h.window.width = 1100;
  h.window.height = 800;
  await prepareRecordingWindow(tab, immediate);
  assert.equal(h.window.width, 1280);
  assert.equal(h.window.height, 1020);
  assert.equal(h.writes.length, 1);
});

test("recording uses saved width and the entire usable height above the taskbar", async () => {
  const h = setup();
  const refreshed = await prepareRecordingWindow(tab, immediate);
  assert.deepEqual(h.updates, [{ width: 960, height: 1020, top: 30, left: 80 }]);
  assert.deepEqual(refreshed, { id: 42, windowId: 9, width: 944, height: 920 });
  assert.equal(h.writes.length, 0);
});

test("height is recalculated when the usable display area changes", async () => {
  const h = setup();
  await prepareRecordingWindow(tab, immediate);
  h.displays[0].workArea.height = 980;
  await prepareRecordingWindow(tab, immediate);
  assert.equal(h.window.height, 980);
  assert.deepEqual(h.preferences, { [WINDOW_WIDTH_KEY]: 960 });
});

test("fullscreen, maximized, and minimized windows are restored before sizing", async () => {
  for (const state of ["fullscreen", "maximized", "minimized"]) {
    const h = setup({ state });
    await prepareRecordingWindow(tab, immediate);
    assert.deepEqual(h.updates, [{ state: "normal" }, { width: 960, height: 1020, top: 30, left: 80 }]);
    assert.equal(h.window.state, "normal");
  }
});

test("the monitor containing most of the window supplies the height", async () => {
  const h = setup();
  h.displays.push({
    id: "secondary", isEnabled: true,
    bounds: { left: 1920, top: -200, width: 1440, height: 1200 },
    workArea: { left: 1920, top: -180, width: 1440, height: 1160 },
  });
  h.window.left = 1800;
  h.window.top = -100;
  await prepareRecordingWindow(tab, immediate);
  assert.equal(h.window.height, 1160);
  assert.equal(h.window.top, -180);
  assert.equal(h.window.left, 1920);
});

test("a monitor left of the primary display keeps its negative coordinates", async () => {
  const h = setup();
  h.displays.push({
    id: "left", isEnabled: true,
    bounds: { left: -1600, top: 0, width: 1600, height: 900 },
    workArea: { left: -1600, top: 24, width: 1600, height: 850 },
  });
  h.window.left = -1500;
  await prepareRecordingWindow(tab, immediate);
  assert.equal(h.window.left, -1500);
  assert.equal(h.window.top, 24);
  assert.equal(h.window.height, 850);
});

test("a fullscreen window keeps its original monitor when restoring moves it", async () => {
  const h = setup({ state: "fullscreen" });
  h.displays.push({
    id: "secondary", isEnabled: true,
    bounds: { left: 1920, top: 0, width: 1440, height: 1200 },
    workArea: { left: 1920, top: 20, width: 1440, height: 1160 },
  });
  h.window.left = 2000;
  const update = chrome.windows.update;
  chrome.windows.update = async (id, values) => {
    if (values.state === "normal") h.window.left = 80;
    return update(id, values);
  };
  await prepareRecordingWindow(tab, immediate);
  assert.equal(h.window.left, 1920);
  assert.equal(h.window.height, 1160);
});

test("a window near the right edge is moved inside the usable screen area", async () => {
  const h = setup();
  h.window.left = 1700;
  await prepareRecordingWindow(tab, immediate);
  assert.equal(h.window.left, 1920 - 960);
  assert.equal(h.window.top, 30);
});

test("capture waits for the webpage dimensions to settle after resizing", async () => {
  setup();
  const viewports = [{ width: 1264, height: 800 }, { width: 944, height: 920 }, { width: 944, height: 920 }];
  let reads = 0;
  chrome.tabs.get = async () => ({ ...tab, ...viewports[reads++] });
  const refreshed = await prepareRecordingWindow(tab, immediate);
  assert.equal(reads, 3);
  assert.equal(refreshed.width, 944);
  assert.equal(refreshed.height, 920);
});

test("a saved width wider than the display produces a clear error", async () => {
  const h = setup({ width: 2000 });
  await assert.rejects(prepareRecordingWindow(tab, immediate), /exceeds this display's available width.*1920.*Options/);
  assert.equal(h.updates.length, 0);
});

test("a size the operating system refuses produces a clear error", async () => {
  setup({ clamp: true });
  await assert.rejects(prepareRecordingWindow(tab, immediate), /could not resize.*960 × 1020.*Options/);
});

test("moving the tab to a different window during preparation cancels capture", async () => {
  setup();
  chrome.tabs.get = async () => ({ id: 42, windowId: 99, width: 944, height: 920 });
  await assert.rejects(prepareRecordingWindow(tab, immediate), /moved to another window/);
});

test("disabled displays are ignored and an offscreen window uses the nearest display", () => {
  const h = setup();
  const display = h.displays[0];
  assert.equal(selectRecordingDisplay({ ...h.window, left: -5000 }, [display]).id, "primary");
  assert.throws(() => selectRecordingDisplay(h.window, [{ ...display, isEnabled: false }]), /available display height/);
});
