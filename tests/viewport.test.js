import test from "node:test";
import assert from "node:assert/strict";
import { mockChrome, page } from "./helpers.mjs";
import { fittedViewport, startViewport, closeViewport, refreshViewport, restorePendingViewport } from "../viewport.js";

test("fixed desktop and mobile dimensions preserve aspect ratio at any screen size", () => {
  const session = { settings: { width: 1600, height: 900 }, fullscreenInsets: { width: 0, height: 0 } };
  assert.deepEqual(fittedViewport(session, { width: 1280, height: 1024 }), { width: 1600, height: 900, scale: 1024 / 900, visibleWidth: 1820, visibleHeight: 1024 });
  session.settings = { width: 390, height: 844 };
  const mobile = fittedViewport(session, { width: 1920, height: 1080 });
  assert.equal(mobile.visibleHeight, 1080);
  assert.equal(mobile.visibleWidth, 499);
  assert.equal(mobile.width, 390);
  assert.equal(mobile.height, 844);
});
test("desktop keeps its saved layout and scales to the full height when fullscreen space changes", async () => {
  const h = mockChrome();
  const session = h.activate();
  h.window.width = 1600; h.window.height = 1000;
  await refreshViewport(session);
  assert.deepEqual(session.view, { width: 1920, height: 1080, scale: 1000 / 1080, visibleWidth: 1778, visibleHeight: 1000 });
  const count = h.calls.length;
  await refreshViewport(session);
  assert.equal(h.calls.length, count);
});
test("toggle-off exits fullscreen even if the window was already fullscreen at activation", async () => {
  const h = mockChrome(); h.window.state = "fullscreen"; h.window.width = 1920; h.window.height = 1080;
  const session = await startViewport(page, { width: 1300, height: 731 }, "desktop");
  assert.equal(session.restoreState, "normal");
  await closeViewport(session);
  assert.equal(h.window.state, "normal");
  assert.deepEqual(h.calls.filter(call => call.method === "Emulation.setVisibleSize").at(-1).params, { width: 1100, height: 760 });
  assert.ok(h.calls.filter(call => call.type === "WINDOW_UPDATE").every(call => Object.keys(call.changes).join() === "state"));
});
test("failed session persistence still releases debugger ownership", async () => {
  const h = mockChrome();
  const set = chrome.storage.session.set;
  chrome.storage.session.set = async values => { if (values.viewportSession) throw new Error("Storage unavailable"); return set(values); };
  await assert.rejects(startViewport(page, { width: 1300, height: 731 }, "desktop"), /Storage unavailable/);
  assert.equal(h.attached, false);
  assert.equal(h.window.state, "normal");
});
test("a competing debugger is untouched and failed restoration retries before another activation", async () => {
  const h = mockChrome();
  const session = h.activate();
  const attach = chrome.debugger.attach;
  chrome.debugger.attach = async () => { throw new Error("Another debugger is attached"); };
  await assert.rejects(closeViewport(session, { detached: true }), /Close Inspect/);
  assert.equal(h.window.state, "normal");
  assert.equal(h.calls.some(call => call.type === "DETACH"), false);
  assert.equal(h.sessionStorage.viewportSession, undefined);
  assert.ok(h.sessionStorage.viewportRestorePending);
  chrome.debugger.attach = attach;
  await restorePendingViewport();
  assert.equal(h.sessionStorage.viewportRestorePending, undefined);
  assert.equal(h.attached, false);
});
test("a closed pending target is discarded instead of blocking the next activation", async () => {
  const h = mockChrome();
  h.sessionStorage.viewportRestorePending = h.activate();
  delete h.sessionStorage.viewportSession;
  chrome.tabs.get = async () => { throw new Error("No tab"); };
  chrome.windows.get = async () => { throw new Error("No window"); };
  await restorePendingViewport();
  assert.equal(h.sessionStorage.viewportRestorePending, undefined);
  assert.equal(h.calls.length, 0);
});

test("a delayed fullscreen window state is awaited instead of rejecting stable old dimensions", async () => {
  const h = mockChrome();
  const update = chrome.windows.update, get = chrome.windows.get;
  let reads = 0, transitioning = false;
  chrome.windows.update = async (id, changes) => {
    const value = await update(id, changes);
    if (changes.state === "fullscreen") transitioning = true;
    return value;
  };
  chrome.windows.get = async (...args) => {
    const bounds = await get(...args);
    if (transitioning && ++reads < 18) bounds.state = "normal";
    return bounds;
  };
  const session = await startViewport(page, { width: 1300, height: 731 }, "desktop");
  assert.ok(reads >= 18);
  assert.equal(session.fullscreenMethod, "window");
  assert.equal(h.calls.some(call => call.type === "DOCUMENT_FULLSCREEN_ENTER"), false);
});
test("an ignored window fullscreen request falls back to actual page fullscreen and fits its real size", async () => {
  const h = mockChrome();
  const update = chrome.windows.update;
  chrome.windows.update = async (id, changes) => {
    if (changes.state === "fullscreen") { h.calls.push({ type: "WINDOW_UPDATE", windowId: id, changes }); return { ...h.window }; }
    return update(id, changes);
  };
  const session = await startViewport(page, { width: 390, height: 844 }, "mobile");
  assert.equal(h.window.state, "normal"); // Deliberately stale Arc window API.
  assert.equal(session.fullscreenMethod, "document");
  assert.ok(h.document.fullscreenElement);
  assert.equal(session.view.visibleHeight, 1080);
  assert.equal(session.view.visibleWidth, 499);
  // A later window-bounds report must not double-count fullscreen space.
  h.window.width = 1920; h.window.height = 1080;
  await refreshViewport(session);
  assert.equal(session.view.visibleHeight, 1080);
  assert.equal(session.view.visibleWidth, 499);
  const request = h.calls.find(call => call.method === "Runtime.evaluate" && call.params.expression.includes("requestFullscreen"));
  assert.equal(request.params.userGesture, true);
  assert.equal(request.params.awaitPromise, true);
  const fallbackIndex = h.calls.findIndex(call => call.type === "DOCUMENT_FULLSCREEN_ENTER");
  assert.ok(fallbackIndex < h.calls.findIndex(call => call.method === "Emulation.setDeviceMetricsOverride"));
  await closeViewport(session);
  assert.equal(h.document.fullscreenElement, null);
  assert.equal(h.attached, false);
  assert.equal(h.sessionStorage.viewportSession, undefined);
  assert.deepEqual(h.calls.filter(call => call.method === "Emulation.setVisibleSize").at(-1).params, { width: 1100, height: 760 });
});
test("a rejected native request can still use page fullscreen for desktop dimensions", async () => {
  const h = mockChrome();
  const update = chrome.windows.update;
  chrome.windows.update = async (id, changes) => {
    if (changes.state === "fullscreen") throw new Error("Window fullscreen unsupported");
    return update(id, changes);
  };
  const session = await startViewport(page, { width: 1280, height: 720 }, "desktop");
  assert.equal(session.fullscreenMethod, "document");
  assert.deepEqual(session.view, { width: 1280, height: 720, scale: 1.5, visibleWidth: 1920, visibleHeight: 1080 });
});
test("when both fullscreen methods fail, no viewport is applied and debugger ownership is released", async () => {
  const h = mockChrome();
  const update = chrome.windows.update;
  chrome.windows.update = async (id, changes) => {
    if (changes.state === "fullscreen") throw new Error("Unsupported window request");
    return update(id, changes);
  };
  h.document.documentElement.requestFullscreen = async () => { throw new Error("Fullscreen denied"); };
  await assert.rejects(startViewport(page, { width: 1300, height: 731 }, "desktop"), /Fullscreen denied/);
  assert.equal(h.attached, false);
  assert.equal(h.sessionStorage.viewportSession, undefined);
  assert.equal(h.document.fullscreenElement, null);
  assert.equal(h.calls.some(call => call.method === "Emulation.setDeviceMetricsOverride"), false);
});

test("a wide desktop paints only visible pixels while keeping full-height scaling and its CSS aspect ratio", async () => {
  const h = mockChrome();
  const session = h.activate({ settings: { width: 1600, height: 900 } });
  h.window.width = 1280; h.window.height = 1024;
  await refreshViewport(session);
  assert.equal(session.view.scale, 1024 / 900);
  assert.equal(session.view.visibleHeight, 1024);
  assert.equal(session.view.visibleWidth, 1820);
  const metrics = h.calls.find(call => call.method === "Emulation.setDeviceMetricsOverride");
  assert.equal(metrics.params.width, 1600); assert.equal(metrics.params.height, 900);
  assert.deepEqual(h.calls.filter(call => call.method === "Emulation.setVisibleSize").at(-1).params, { width: 1280, height: 1024 });
  h.window.width = 1400;
  await refreshViewport(session);
  assert.deepEqual(h.calls.filter(call => call.method === "Emulation.setVisibleSize").at(-1).params, { width: 1400, height: 1024 });
  assert.equal(session.view.scale, 1024 / 900);
});
