import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCROLL_SETTINGS, SCROLL_SETTINGS_KEY, MOBILE_SETTINGS_KEY } from "../settings.js";

let moduleNumber = 0;
async function setup(status = { phase: "idle" }, exists = false, savedWidth = null) {
  const calls = [];
  const actions = {};
  const events = {};
  const sessionStorage = {};
  const preferences = savedWidth != null ? { recordingWindowWidth: savedWidth } : {};
  const window = { id: 9, width: 1116, height: 860, left: 100, top: 50, state: "normal", focused: true };
  const event = name => ({ addListener: listener => { events[name] = listener; } });
  globalThis.chrome = {
    runtime: {
      id: "test-extension",
      getURL: path => `chrome-extension://test-extension/${path}`,
      getContexts: async () => exists ? [{}] : [],
      sendMessage: async message => { calls.push(message); return { ok: true, status }; },
      onMessage: event("message"),
      onInstalled: event("installed"),
      onStartup: event("startup"),
    },
    debugger: {
      attach: async target => { calls.push({ type: "DEBUG_ATTACH", ...target }); },
      sendCommand: async (target, method, params) => { calls.push({ type: "DEBUG_COMMAND", ...target, method, params }); },
      detach: async target => { calls.push({ type: "DEBUG_DETACH", ...target }); },
      onDetach: event("debugDetached"), onEvent: event("debugEvent"),
    },
    action: {
      onClicked: event("click"),
      ...Object.fromEntries(["setIcon", "setTitle", "setBadgeText", "setBadgeBackgroundColor", "setBadgeTextColor"].map(name => [name, async value => { actions[name] = value; }])),
    },
    commands: { onCommand: event("command"), getAll: async () => [{ name: "scroll-down", shortcut: "⌃⌘Z" }] },
    scripting: {
      executeScript: async options => { calls.push({ type: "SCRIPT", ...options }); return [{ result: { running: true } }]; },
      insertCSS: async options => { calls.push({ type: "CSS_INSERT", ...options }); },
      removeCSS: async options => { calls.push({ type: "CSS_REMOVE", ...options }); },
    },
    offscreen: { createDocument: async options => { calls.push({ type: "CREATE", ...options }); exists = true; } },
    tabCapture: { getMediaStreamId: async options => { calls.push({ type: "CAPTURE", ...options }); return "stream-id"; } },
    downloads: { download: async () => 7, search: async () => [{ state: "complete" }] },
    storage: { onChanged: event("storage"), session: {
      get: async key => ({ [key]: structuredClone(sessionStorage[key]) }),
      set: async values => { Object.assign(sessionStorage, structuredClone(values)); },
      remove: async key => { delete sessionStorage[key]; },
    }, local: {
      get: async () => structuredClone(preferences),
      set: async values => { Object.assign(preferences, structuredClone(values)); },
      remove: async key => { delete preferences[key]; },
    } },
    system: { display: { getInfo: async () => [{
      id: "primary", isEnabled: true,
      bounds: { left: 0, top: 0, width: 1920, height: 1080 },
      workArea: { left: 0, top: 24, width: 1920, height: 1032 },
    }] } },
    windows: {
      onBoundsChanged: event("boundsChanged"),
      getLastFocused: async () => ({ ...window }),
      get: async windowId => { calls.push({ type: "WINDOW_GET", windowId }); return { ...window }; },
      update: async (windowId, changes) => { calls.push({ type: "WINDOW_UPDATE", windowId, ...changes }); Object.assign(window, changes); return { ...window }; },
    },
    tabs: { onUpdated: event("tabUpdated"), onActivated: event("tabActivated"), get: async tabId => {
      calls.push({ type: "TAB_GET", tabId });
      return { id: tabId, windowId: 9, width: window.width - 16, height: window.height - 100 };
    } },
  };
  const background = await import(`../background.js?test=${moduleNumber++}`);
  return { ...background, calls, actions, events, preferences, window, sessionStorage };
}

test("toolbar click captures the clicked tab without a popup", async () => {
  const h = await setup();
  await h.toggleRecording({ id: 42, windowId: 9, url: "https://example.com", width: 1100, height: 760 });
  assert.equal(h.calls.filter(call => call.type === "CREATE").length, 1);
  assert.deepEqual(h.calls.find(call => call.type === "CAPTURE"), { type: "CAPTURE", targetTabId: 42 });
  const { cursorSessionId, ...start } = h.calls.find(call => call.type === "START");
  assert.equal(typeof cursorSessionId, "string");
  assert.deepEqual(start, { target: "recorder", type: "START", streamId: "stream-id", tabId: 42, viewport: { width: 1100, height: 932 } });
  const cursor = h.calls.find(call => call.type === "CSS_INSERT");
  assert.equal(cursor.origin, "USER");
  assert.deepEqual(cursor.target, { tabId: 42, allFrames: true });
  assert.match(cursor.css, /cursor: none !important/);
  assert.ok(h.calls.indexOf(cursor) < h.calls.findIndex(call => call.type === "CAPTURE"));
});

test("clicking from another tab stops the existing recording", async () => {
  const h = await setup({ phase: "recording", tabId: 42 }, true);
  await h.toggleRecording({ id: 99, url: "chrome://settings" });
  assert.equal(h.calls.at(-1).type, "STOP");
  assert.equal(h.calls.filter(call => call.type === "CAPTURE").length, 0);
});

test("starting and saving ignore further clicks", async () => {
  for (const phase of ["starting", "saving"]) {
    const h = await setup({ phase }, true);
    await h.toggleRecording({ id: 1, url: "https://example.com" });
    assert.deepEqual(h.calls.map(call => call.type), ["STATUS"]);
  }
});

test("a worker restart uses the offscreen recorder's real status", async () => {
  await setup();
  const h = await setup({ phase: "recording", tabId: 12 }, true);
  await h.toggleRecording({ id: 50, url: "https://example.com" });
  assert.deepEqual(h.calls.map(call => call.type), ["STATUS", "STOP"]);
});

test("a failed download is retried before another recording is created", async () => {
  const h = await setup({ phase: "error", retryAvailable: true }, true);
  await h.toggleRecording({ id: 1, url: "https://example.com" });
  assert.deepEqual(h.calls.map(call => call.type), ["STATUS", "RETRY_SAVE"]);
});

test("protected pages fail without acquiring a capture stream", async () => {
  const h = await setup();
  await assert.rejects(h.toggleRecording({ id: 1, url: "chrome://extensions" }), /regular webpage/);
  assert.equal(h.calls.length, 0);
});

test("recording and idle badges and icon match the current state", async () => {
  const h = await setup();
  await h.updateAction({ phase: "recording" });
  assert.equal(h.actions.setBadgeText.text, "REC");
  assert.match(h.actions.setTitle.title, /click to stop/);
  assert.match(h.actions.setIcon.path[16], /stop-16/);
  await h.updateAction({ phase: "idle" });
  assert.equal(h.actions.setBadgeText.text, "");
  assert.match(h.actions.setIcon.path[16], /record-16/);
});

test("messages from websites cannot trigger downloads", async () => {
  const h = await setup();
  let responded = false;
  const response = h.events.message({ target: "background", type: "DOWNLOAD", url: "https://example.com" }, { id: "test-extension", url: "https://example.com" }, () => { responded = true; });
  assert.equal(response, undefined);
  assert.equal(responded, false);
});

test("a burst of toolbar clicks creates only one capture request", async () => {
  const h = await setup();
  const tab = { id: 7, windowId: 9, url: "https://example.com" };
  h.events.click(tab);
  h.events.click(tab);
  h.events.click(tab);
  for (let attempt = 0; attempt < 100 && !h.calls.some(call => call.type === "CAPTURE"); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(h.calls.filter(call => call.type === "CAPTURE").length, 1);
});

test("saved width and automatic height are applied before capture and the resized viewport is used", async () => {
  const h = await setup({ phase: "idle" }, false, 960);
  await h.toggleRecording({ id: 42, windowId: 9, url: "https://example.com", width: 1100, height: 760 });
  const resize = h.calls.findIndex(call => call.type === "WINDOW_UPDATE");
  const capture = h.calls.findIndex(call => call.type === "CAPTURE");
  assert.ok(resize >= 0 && capture > resize);
  assert.deepEqual(h.calls[resize], { type: "WINDOW_UPDATE", windowId: 9, width: 960, height: 1032, top: 24, left: 100 });
  assert.deepEqual(h.calls.find(call => call.type === "START").viewport, { width: 944, height: 932 });
  assert.equal(h.preferences.recordingWindowWidth, 960);
});

test("a rejected window resize does not start capture", async () => {
  const h = await setup({ phase: "idle" }, false, 960);
  chrome.windows.update = async () => { throw new Error("Window resize was rejected"); };
  await assert.rejects(h.toggleRecording({ id: 42, windowId: 9, url: "https://example.com" }), /resize was rejected/);
  assert.equal(h.calls.some(call => call.type === "CAPTURE"), false);
});

test("mobile mode emulates the original tab before capture without resizing its browser", async () => {
  const h = await setup();
  h.preferences[MOBILE_SETTINGS_KEY] = { enabled: true, width: 390, height: 844 };
  await h.toggleRecording({ id: 42, windowId: 9, url: "https://example.com" });
  const start = h.calls.find(call => call.type === "START");
  assert.equal(start.viewport.mobile.width, 390);
  assert.equal(start.viewport.mobile.height, 844);
  assert.equal(start.viewport.width, 1100);
  assert.equal(start.viewport.height, 760);
  assert.equal(start.mobileSessionId, h.sessionStorage.nativeMobileViewport.sessionId);
  const metrics = h.calls.find(call => call.method === "Emulation.setDeviceMetricsOverride");
  assert.deepEqual(metrics.params, { width: 390, height: 844, deviceScaleFactor: 0, mobile: true, screenWidth: 390, screenHeight: 844, scale: 760 / 844, dontSetVisibleSize: true });
  assert.ok(h.calls.indexOf(metrics) < h.calls.findIndex(call => call.type === "CAPTURE"));
  assert.equal(h.calls.some(call => call.type === "WINDOW_UPDATE"), false);
  assert.equal(h.calls.some(call => call.type === "SCRIPT"), false);
});

test("mobile capture failure restores native emulation and the cursor", async () => {
  const h = await setup();
  h.preferences[MOBILE_SETTINGS_KEY] = { enabled: true, width: 390, height: 844 };
  chrome.tabCapture.getMediaStreamId = async () => { throw new Error("Capture denied"); };
  await assert.rejects(h.toggleRecording({ id: 42, windowId: 9, url: "https://example.com" }), /Capture denied/);
  assert.ok(h.calls.some(call => call.method === "Emulation.clearDeviceMetricsOverride"));
  assert.equal(h.calls.at(-1).type, "DEBUG_DETACH");
  assert.equal(h.sessionStorage.nativeMobileViewport, undefined);
  assert.equal(h.calls.find(call => call.type === "CSS_REMOVE").css, h.calls.find(call => call.type === "CSS_INSERT").css);
});

test("a tab with another debugger is left untouched and cannot start capture", async () => {
  const h = await setup();
  h.preferences[MOBILE_SETTINGS_KEY] = { enabled: true, width: 390, height: 844 };
  chrome.debugger.attach = async () => { throw new Error("Another debugger is already attached"); };
  await assert.rejects(h.toggleRecording({ id: 42, windowId: 9, url: "https://example.com" }), /Close Inspect/);
  assert.equal(h.calls.some(call => call.type === "CAPTURE" || call.type === "DEBUG_DETACH"), false);
});

test("a rejected mobile metrics command rolls back and does not start capture", async () => {
  const h = await setup();
  h.preferences[MOBILE_SETTINGS_KEY] = { enabled: true, width: 390, height: 844 };
  chrome.debugger.sendCommand = async (target, method) => {
    h.calls.push({ type: "DEBUG_COMMAND", method });
    if (method === "Emulation.setDeviceMetricsOverride") throw new Error("Metrics rejected");
  };
  await assert.rejects(h.toggleRecording({ id: 42, windowId: 9, url: "https://example.com" }), /Metrics rejected/);
  assert.ok(h.calls.some(call => call.method === "Emulation.clearDeviceMetricsOverride"));
  assert.equal(h.calls.some(call => call.type === "CAPTURE"), false);
  assert.equal(h.sessionStorage.nativeMobileViewport, undefined);
});

test("failure to persist an attached mobile session still releases the debugger", async () => {
  const h = await setup();
  h.preferences[MOBILE_SETTINGS_KEY] = { enabled: true, width: 390, height: 844 };
  chrome.storage.session.set = async () => { throw new Error("Storage unavailable"); };
  await assert.rejects(h.toggleRecording({ id: 42, windowId: 9, url: "https://example.com" }), /Storage unavailable/);
  assert.ok(h.calls.some(call => call.type === "DEBUG_DETACH"));
  assert.equal(h.calls.some(call => call.type === "CAPTURE"), false);
});

test("a debugger disconnect saves the mobile recording instead of continuing at desktop size", async () => {
  const h = await setup({ phase: "recording", tabId: 42, sessionId: "recording", mobileSessionId: "mobile" }, true);
  h.sessionStorage.nativeMobileViewport = { tabId: 42, sessionId: "mobile" };
  await h.events.debugDetached({ tabId: 42 });
  assert.match(h.calls.find(call => call.type === "STOP").error, /disconnected/);
  assert.equal(h.sessionStorage.nativeMobileViewport, undefined);
});

test("both commands scroll down: saved percentage and a full viewport, with the same duration", async () => {
  const h = await setup({ phase: "recording", tabId: 42, sessionId: "recording-one" }, true);
  h.preferences[SCROLL_SETTINGS_KEY] = { ...DEFAULT_SCROLL_SETTINGS, enabled: true };
  await h.events.command("scroll-down", { id: 42 });
  await h.events.command("scroll-up", { id: 42 });
  const scripts = h.calls.filter(call => call.type === "SCRIPT");
  assert.equal(scripts.length, 2);
  assert.deepEqual(scripts[0].target, { tabId: 42 });
  assert.deepEqual(scripts[0].args, [{ action: "step", direction: 1, settings: { ...DEFAULT_SCROLL_SETTINGS, enabled: true }, sessionId: "recording-one" }]);
  assert.deepEqual(scripts[1].args, [{ action: "step", direction: 1, settings: { ...DEFAULT_SCROLL_SETTINGS, enabled: true, stepPercent: 100 }, sessionId: "recording-one" }]);
  assert.equal(h.preferences[SCROLL_SETTINGS_KEY].stepPercent, DEFAULT_SCROLL_SETTINGS.stepPercent);
});

test("the Arc full-viewport page shortcut ignores a custom percentage without changing it", async () => {
  const h = await setup({ phase: "recording", tabId: 42, sessionId: "one" }, true);
  h.preferences[SCROLL_SETTINGS_KEY] = { ...DEFAULT_SCROLL_SETTINGS, enabled: true, stepPercent: 45, durationMs: 2000 };
  await h.handleScrollCommand("scroll-up", { source: "page", tabId: 42, sessionId: "one" });
  const step = h.calls.find(call => call.type === "SCRIPT").args[0];
  assert.equal(step.direction, 1);
  assert.equal(step.settings.stepPercent, 100);
  assert.equal(step.settings.durationMs, 2000);
  assert.equal(h.preferences[SCROLL_SETTINGS_KEY].stepPercent, 45);
});

test("the scrolling switch disables shortcut actions", async () => {
  const h = await setup({ phase: "recording", tabId: 42, sessionId: "recording-one" }, true);
  await h.handleScrollCommand("scroll-down", { id: 42 });
  assert.equal(h.calls.some(call => call.type === "SCRIPT"), false);
});

test("shortcuts do not scroll while idle or when the browser is in the background", async () => {
  for (const [status, focused] of [[{ phase: "idle" }, true], [{ phase: "recording", tabId: 42, sessionId: "one" }, false]]) {
    const h = await setup(status, true);
    h.window.focused = focused;
    h.preferences[SCROLL_SETTINGS_KEY] = { ...DEFAULT_SCROLL_SETTINGS, enabled: true };
    await h.handleScrollCommand("scroll-down", { id: 42 });
    assert.equal(h.calls.some(call => call.type === "SCRIPT"), false);
  }
});

test("Arc commands use the recorded tab even with a missing or different callback tab", async () => {
  const h = await setup({ phase: "recording", tabId: 42, sessionId: "arc-recording" }, true);
  h.preferences[SCROLL_SETTINGS_KEY] = { ...DEFAULT_SCROLL_SETTINGS, enabled: true };
  await h.handleScrollCommand("scroll-down");
  await h.handleScrollCommand("scroll-down", { id: 99 });
  const scripts = h.calls.filter(call => call.type === "SCRIPT");
  assert.equal(scripts.length, 2);
  assert.ok(scripts.every(script => script.target.tabId === 42));
});

test("stopping a recording cancels the animation before stopping video capture", async () => {
  const h = await setup({ phase: "recording", tabId: 42, sessionId: "one" }, true);
  await h.toggleRecording({ id: 99 });
  assert.deepEqual(h.calls.map(call => call.type), ["STATUS", "SCRIPT", "STOP"]);
  assert.deepEqual(h.calls[1].args, [{ action: "cancel", sessionId: "one" }]);
});

test("disabling the main switch immediately cancels a pending animation", async () => {
  const h = await setup({ phase: "recording", tabId: 42, sessionId: "one" }, true);
  await h.events.storage({ [SCROLL_SETTINGS_KEY]: { newValue: { ...DEFAULT_SCROLL_SETTINGS, enabled: false } } }, "local");
  assert.equal(h.calls.find(call => call.type === "SCRIPT").args[0].action, "cancel");
});

test("Arc page shortcuts authenticate the recorded tab and session", async () => {
  const h = await setup({ phase: "recording", tabId: 42, sessionId: "one" }, true);
  h.preferences[SCROLL_SETTINGS_KEY] = { ...DEFAULT_SCROLL_SETTINGS, enabled: true };
  for (const input of [{ source: "page", tabId: 99, sessionId: "one" }, { source: "page", tabId: 42, sessionId: "old" }]) {
    await h.handleScrollCommand("scroll-down", input);
  }
  assert.equal(h.calls.filter(call => call.type === "SCRIPT").length, 0);
  await h.handleScrollCommand("scroll-down", { source: "page", tabId: 42, sessionId: "one" });
  assert.equal(h.calls.filter(call => call.type === "SCRIPT").length, 1);
});

test("native and page delivery of the same key scroll once, preserving rapid repeated presses", async () => {
  const h = await setup({ phase: "recording", tabId: 42, sessionId: "one" }, true);
  h.preferences[SCROLL_SETTINGS_KEY] = { ...DEFAULT_SCROLL_SETTINGS, enabled: true };
  const page = { source: "page", tabId: 42, sessionId: "one" };
  await h.handleScrollCommand("scroll-down", page);
  await h.handleScrollCommand("scroll-down");
  await h.handleScrollCommand("scroll-down");
  await h.handleScrollCommand("scroll-down", page);
  assert.equal(h.calls.filter(call => call.type === "SCRIPT").length, 2);
});

test("recording status installs the actual assigned Arc shortcut; navigation reattaches it", async () => {
  const h = await setup({ phase: "recording", tabId: 42, sessionId: "one" }, true);
  h.preferences[SCROLL_SETTINGS_KEY] = { ...DEFAULT_SCROLL_SETTINGS, enabled: true };
  await h.events.tabUpdated(42, { status: "complete" });
  const script = h.calls.find(call => call.type === "SCRIPT");
  assert.deepEqual(script.args, [{ action: "install", sessionId: "one", commands: [{ name: "scroll-down", shortcut: "⌃⌘Z" }] }]);
  assert.equal(script.target.tabId, 42);
});

test("Chrome's own stop-sharing status also cancels a pending animation", async () => {
  const h = await setup();
  await new Promise(resolve => {
    const retained = h.events.message({
      target: "background", type: "STATUS_CHANGED", status: { phase: "saving", tabId: 42, sessionId: "one" },
    }, { id: "test-extension", url: "chrome-extension://test-extension/offscreen.html" }, response => {
      assert.equal(response.ok, true);
      resolve();
    });
    assert.equal(retained, true);
  });
  assert.equal(h.calls.find(call => call.type === "SCRIPT").args[0].action, "cancel");
});
