import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setup, page } from "./helpers.mjs";
import { DEFAULT_SCROLL_SETTINGS, SCROLL_SETTINGS_KEY, MOBILE_SETTINGS_KEY, COLLECT_POINTS_KEY, SCROLL_POINTS_KEY } from "../settings.js";
const scrolling = { ...DEFAULT_SCROLL_SETTINGS, enabled: true };
const steps = h => h.calls.filter(call => call.type === "SCRIPT" && ["step", "point"].includes(call.args?.[0]?.action));

test("desktop toggle enters fullscreen, sets page dimensions only, and restores on the second click", async () => {
  const h = await setup({ desktopViewportSettings: { width: 1280, height: 0 } });
  await h.toggleViewport(page);
  assert.equal(h.window.state, "fullscreen");
  assert.equal(h.sessionStorage.viewportSession.view.width, 1280);
  assert.equal(h.sessionStorage.viewportSession.view.height, 1440);
  assert.equal(h.calls.find(call => call.method === "Emulation.setDeviceMetricsOverride").params.mobile, false);
  assert.deepEqual(h.calls.find(call => call.method === "Emulation.setVisibleSize").params, { width: 960, height: 1080 });
  assert.equal(h.actions.setBadgeText.text, "ON");
  assert.ok(h.calls.some(call => call.args?.[0]?.commands?.some(command => command.shortcut === "⌃Z")));
  await h.toggleViewport({ id: 99, url: "chrome://settings" });
  assert.equal(h.window.state, "normal");
  assert.equal(h.sessionStorage.viewportSession, undefined);
  assert.equal(h.attached, false);
  assert.equal(h.actions.setBadgeText.text, "");
  assert.deepEqual(h.calls.filter(call => call.method === "Emulation.setVisibleSize").at(-1).params, { width: 1100, height: 760 });
  assert.ok(h.calls.filter(call => call.type === "WINDOW_UPDATE").every(call => Object.keys(call.changes).join() === "state"));
  const cancel = h.calls.findIndex(call => call.args?.[0]?.action === "cancel");
  assert.ok(cancel < h.calls.findIndex(call => call.method === "Emulation.clearDeviceMetricsOverride"));
});
test("mobile uses the original tab, fullscreen and a left-anchored fitted page surface", async () => {
  const h = await setup({ [MOBILE_SETTINGS_KEY]: { enabled: true, width: 390, height: 844 } });
  await h.toggleViewport(page);
  const metrics = h.calls.find(call => call.method === "Emulation.setDeviceMetricsOverride");
  assert.equal(metrics.tabId, page.id);
  assert.equal(metrics.params.mobile, true);
  assert.equal(metrics.params.width, 390);
  assert.equal(metrics.params.height, 844);
  assert.equal(metrics.params.positionX, 0);
  assert.equal(metrics.params.positionY, 0);
  assert.equal(metrics.params.scale, 1080 / 844);
  assert.deepEqual(h.calls.find(call => call.method === "Emulation.setVisibleSize").params, { width: 499, height: 1080 });
});
test("existing debugger is never taken over and fullscreen is untouched if attach fails", async () => {
  const h = await setup();
  chrome.debugger.attach = async () => { throw new Error("Already attached"); };
  await assert.rejects(h.toggleViewport(page), /Close Inspect/);
  assert.equal(h.window.state, "normal");
  assert.equal(h.calls.some(call => call.type === "WINDOW_UPDATE" || call.type === "DEBUG" || call.type === "DETACH"), false);
});
test("rejected metrics roll back fullscreen and debugger ownership", async () => {
  const h = await setup();
  const send = chrome.debugger.sendCommand;
  chrome.debugger.sendCommand = async (...args) => { if (args[1] === "Emulation.setDeviceMetricsOverride") throw new Error("Metrics rejected"); return send(...args); };
  await assert.rejects(h.toggleViewport(page), /Metrics rejected/);
  assert.equal(h.window.state, "normal");
  assert.equal(h.sessionStorage.viewportSession, undefined);
  assert.equal(h.attached, false);
});
test("protected pages cannot start viewport mode", async () => {
  const h = await setup();
  await assert.rejects(h.toggleViewport({ id: 42, url: "chrome://extensions" }), /regular webpage/);
  assert.equal(h.calls.length, 0);
});
test("percentage and full-height commands both scroll down with the saved duration", async () => {
  const h = await setup({ [SCROLL_SETTINGS_KEY]: scrolling }); h.activate();
  await h.handleScrollCommand("scroll-down"); await h.handleScrollCommand("scroll-up");
  assert.deepEqual(steps(h).map(call => [call.args[0].direction, call.args[0].settings.stepPercent, call.args[0].settings.durationMs]), [[1,30,1500],[1,100,1500]]);
});
test("saved points play once in order independently of the percentage switch and reset on activation", async () => {
  const h = await setup({ [SCROLL_POINTS_KEY]: { "https://example.com/": [200, 850] } }); h.activate();
  await Promise.all([h.handleScrollCommand("scroll-next-point"), h.handleScrollCommand("scroll-next-point"), h.handleScrollCommand("scroll-next-point")]);
  assert.deepEqual(steps(h).map(call => call.args[0].top), [200,850]);
  h.activate({ sessionId: "two" });
  await h.handleScrollCommand("scroll-next-point");
  assert.equal(steps(h).at(-1).args[0].top, 200);
});
test("inactive, disabled, unauthenticated and background key presses cannot scroll", async () => {
  const h = await setup({ [SCROLL_SETTINGS_KEY]: scrolling });
  await h.handleScrollCommand("scroll-down"); h.activate();
  await h.handleScrollCommand("scroll-down", { source: "page", tabId: 99, sessionId: "one" });
  await h.handleScrollCommand("scroll-down", { source: "page", tabId: 42, sessionId: "old" });
  h.window.focused = false; await h.handleScrollCommand("scroll-down"); h.window.focused = true;
  h.preferences[SCROLL_SETTINGS_KEY].enabled = false; await h.handleScrollCommand("scroll-down");
  assert.equal(steps(h).length, 0);
});
test("Arc native and page duplicate delivery scrolls once while rapid distinct presses remain", async () => {
  const h = await setup({ [SCROLL_SETTINGS_KEY]: scrolling }); h.activate();
  await h.handleScrollCommand("scroll-down");
  await h.handleScrollCommand("scroll-down", { source: "page", tabId: 42, sessionId: "one" });
  await h.handleScrollCommand("scroll-down");
  await h.handleScrollCommand("scroll-down");
  assert.equal(steps(h).length, 3);
});
test("disabling shortcuts cancels the animation and keeps the independent next-point binding", async () => {
  const h = await setup(); h.activate();
  await h.events.storage({ [SCROLL_SETTINGS_KEY]: { newValue: DEFAULT_SCROLL_SETTINGS } }, "local");
  assert.ok(h.calls.some(call => call.args?.[0]?.action === "cancel"));
  assert.deepEqual(h.calls.find(call => call.args?.[0]?.action === "install").args[0].commands.map(command => command.name), ["scroll-next-point"]);
});
test("point collection works within viewport mode and remains scoped to the page URL", async () => {
  const h = await setup({ [COLLECT_POINTS_KEY]: true }); h.activate();
  const sender = { id: "test-extension", tab: page, frameId: 0, url: "https://example.com/#section" };
  assert.equal((await h.message({ type: "COLLECT_POINT", top: 512 }, sender)).count, 1);
  assert.equal((await h.message({ type: "COLLECT_POINT", top: 512 }, sender)).count, 1);
  assert.deepEqual(h.preferences[SCROLL_POINTS_KEY], { "https://example.com/": [512] });
  assert.equal((await h.message({ type: "COLLECT_POINT", top: -1 }, sender)).ok, false);
  assert.equal(await h.message({ type: "CLEAR_SCROLL_POINTS" }, sender), undefined);
  assert.equal((await h.message({ type: "CLEAR_SCROLL_POINTS" })).ok, true);
  assert.deepEqual(h.preferences[SCROLL_POINTS_KEY], {});
});
test("leaving fullscreen cancels the session without forcing fullscreen again", async () => {
  const h = await setup(); h.activate(); h.window.state = "normal"; h.window.width = 1120; h.window.height = 860;
  await h.events.boundsChanged({ id: 9 });
  assert.equal(h.sessionStorage.viewportSession, undefined);
  assert.equal(h.calls.some(call => call.changes?.state === "fullscreen"), false);
});
test("debugger cancellation stops shortcuts, exits fullscreen and restores the page surface", async () => {
  const h = await setup(); h.activate(); h.detachExternally();
  await h.events.debugDetached({ tabId: 42 }, "canceled_by_user");
  assert.equal(h.sessionStorage.viewportSession, undefined);
  assert.equal(h.window.state, "normal");
  assert.equal(h.attached, false);
  assert.ok(h.calls.some(call => call.method === "Emulation.clearDeviceMetricsOverride"));
});
test("switching websites and closing the viewport tab both end the session", async () => {
  const h = await setup(); h.activate();
  await h.events.debugEvent({ tabId: 42 }, "Page.frameNavigated", { frame: { url: "https://elsewhere.example/" } });
  assert.equal(h.sessionStorage.viewportSession, undefined);
  h.activate(); await h.events.tabRemoved(42);
  assert.equal(h.sessionStorage.viewportSession, undefined);
  assert.equal(h.window.state, "normal");
});
test("service worker restart uses the persistent viewport session on toggle-off", async () => {
  const h = await setup(); h.activate();
  const response = await h.message({ type: "SET_FULLSCREEN", enabled: false, tabId: 99 }, { id: "test-extension", url: "chrome-extension://test-extension/popup.html" });
  assert.equal(response.ok, true);
  assert.equal(response.state.tabId, 99);
  assert.equal(h.sessionStorage.viewportSession, undefined);
  assert.equal(h.window.state, "normal");
});
test("manifest removes all capture, disk, display and offscreen permissions", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.permissions, ["activeTab", "storage", "scripting", "debugger"]);
  assert.deepEqual(Object.keys(manifest.commands), ["scroll-down", "scroll-up", "scroll-next-point"]);
});

test("a normal Arc window-state report cannot end a confirmed page-fullscreen session", async () => {
  const h = await setup();
  h.activate({ fullscreenMethod: "document" });
  h.window.state = "normal";
  await h.document.documentElement.requestFullscreen();
  await h.events.boundsChanged({ id: 9 });
  assert.equal(h.sessionStorage.viewportSession.phase, "active");
  assert.ok(h.document.fullscreenElement);
});
test("page-fullscreen Escape notification ends only the authenticated matching session", async () => {
  const h = await setup();
  h.activate({ fullscreenMethod: "document" });
  await h.document.documentElement.requestFullscreen();
  const sender = { id: "test-extension", tab: page, frameId: 0, url: page.url };
  await h.message({ type: "VIEWPORT_FULLSCREEN_EXIT", sessionId: "old" }, sender);
  assert.equal(h.sessionStorage.viewportSession.phase, "active");
  await h.message({ type: "VIEWPORT_FULLSCREEN_EXIT", sessionId: "one" }, sender);
  assert.equal(h.sessionStorage.viewportSession.phase, "active"); // Still fullscreen.
  await h.document.exitFullscreen();
  await h.message({ type: "VIEWPORT_FULLSCREEN_EXIT", sessionId: "one" }, sender);
  assert.equal(h.sessionStorage.viewportSession, undefined);
  assert.equal(h.window.state, "normal");
});

const popupSender = { id: "test-extension", url: "chrome-extension://test-extension/popup.html" };
const pageSender = { id: "test-extension", tab: page, frameId: 0, url: page.url };

test("the extension icon opens the controls popup instead of toggling fullscreen", async () => {
  const h = await setup();
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal(h.events.click, undefined);
  const result = await h.message({ type: "POPUP_STATE", tabId: page.id }, popupSender);
  assert.equal(result.state.fullscreen, false);
  assert.equal(result.state.supported, true);
  assert.equal(h.calls.length, 0);
});
test("popup fullscreen setters are idempotent and preserve the selected mobile mode", async () => {
  const h = await setup({ [MOBILE_SETTINGS_KEY]: { enabled: true, width: 390, height: 844 } });
  const on = await h.message({ type: "SET_FULLSCREEN", enabled: true, tabId: page.id }, popupSender);
  assert.equal(on.state.fullscreen, true); assert.equal(on.state.mobile, true);
  const id = h.sessionStorage.viewportSession.sessionId;
  await h.message({ type: "SET_FULLSCREEN", enabled: true, tabId: page.id }, popupSender);
  assert.equal(h.sessionStorage.viewportSession.sessionId, id);
  const off = await h.message({ type: "SET_FULLSCREEN", enabled: false, tabId: page.id }, popupSender);
  assert.equal(off.state.fullscreen, false); assert.equal(off.state.mobile, true);
  assert.equal(h.window.state, "normal");
});
test("switching desktop/mobile changes the active page without leaving fullscreen and retains saved points", async () => {
  const points = { [page.url]: [100, 500] };
  const h = await setup({ [SCROLL_POINTS_KEY]: points }); h.activate();
  h.sessionStorage.scrollPointSequence = { sessionId: "one", url: page.url, index: 1, points: [100,500] };
  const result = await h.message({ type: "SET_MODE", enabled: true, tabId: page.id }, popupSender);
  assert.equal(result.ok, true); assert.equal(result.state.mobile, true);
  assert.equal(h.sessionStorage.viewportSession.sessionId, "one");
  assert.equal(h.sessionStorage.viewportSession.view.width, 390);
  assert.equal(h.sessionStorage.viewportSession.view.height, 844);
  assert.ok(h.calls.some(call => call.method === "Emulation.setDeviceMetricsOverride" && call.params.mobile === true));
  assert.ok(h.calls.some(call => call.method === "Emulation.setTouchEmulationEnabled" && call.params.enabled === true));
  assert.equal(h.window.state, "fullscreen");
  assert.equal(h.calls.some(call => call.type === "WINDOW_UPDATE" || call.type === "DETACH"), false);
  assert.deepEqual(h.preferences[SCROLL_POINTS_KEY], points);
  assert.equal(h.sessionStorage.scrollPointSequence, undefined);
  await h.message({ type: "SET_MODE", enabled: false, tabId: page.id }, popupSender);
  assert.equal(h.sessionStorage.viewportSession.view.width, 1080);
  assert.equal(h.preferences[MOBILE_SETTINGS_KEY].enabled, false);
});
test("an unsuccessful mode switch restores the previous desktop viewport and settings", async () => {
  const h = await setup(); h.activate();
  const send = chrome.debugger.sendCommand;
  chrome.debugger.sendCommand = async (...args) => { if (args[1] === "Emulation.setDeviceMetricsOverride" && args[2].mobile) throw new Error("Mobile metrics rejected"); return send(...args); };
  const result = await h.message({ type: "SET_MODE", enabled: true, tabId: page.id }, popupSender);
  assert.equal(result.ok, false);
  assert.equal(h.sessionStorage.viewportSession.mode, "desktop");
  assert.equal(h.sessionStorage.viewportSession.phase, "active");
  assert.equal(h.preferences[MOBILE_SETTINGS_KEY].enabled, false);
  assert.equal(h.window.state, "fullscreen");
});
test("popup mode selection while inactive saves a preference without entering fullscreen", async () => {
  const h = await setup();
  await h.message({ type: "SET_MODE", enabled: true, tabId: page.id }, popupSender);
  assert.equal(h.preferences[MOBILE_SETTINGS_KEY].enabled, true);
  assert.equal(h.sessionStorage.viewportSession, undefined);
  assert.equal(h.calls.length, 0);
});
test("popup collection is independent of fullscreen and requires existing website permission", async () => {
  const h = await setup();
  chrome.permissions.contains = async () => false;
  const denied = await h.message({ type: "SET_COLLECTION", enabled: true, tabId: page.id }, popupSender);
  assert.equal(denied.ok, false); assert.equal(h.preferences[COLLECT_POINTS_KEY], undefined);
  chrome.permissions.contains = async () => true;
  const allowed = await h.message({ type: "SET_COLLECTION", enabled: true, tabId: page.id }, popupSender);
  assert.equal(allowed.state.collectionEnabled, true); assert.equal(allowed.state.fullscreen, false);
  assert.ok(h.calls.some(call => call.files?.includes("scroll-point-collector.js")));
  await h.message({ type: "SET_COLLECTION", enabled: false, tabId: page.id }, popupSender);
  assert.equal(h.preferences[COLLECT_POINTS_KEY], false);
});
test("page controls remain enabled in fullscreen and new points extend a playing sequence", async () => {
  const h = await setup({ [COLLECT_POINTS_KEY]: true, [SCROLL_POINTS_KEY]: { [page.url]: [100] } }); h.activate();
  h.sessionStorage.scrollPointSequence = { sessionId: "one", url: page.url, index: 1, points: [100] };
  const result = await h.message({ type: "PAGE_CONTROL_STATE" }, pageSender);
  assert.equal(result.state.active, true); assert.equal(result.state.collectionEnabled, true);
  await h.message({ type: "COLLECT_POINT", top: 500 }, pageSender);
  await h.handleScrollCommand("scroll-next-point");
  assert.equal(steps(h).at(-1).args[0].top, 500);
});
test("page clear removes only its own points and another tab cannot switch the active viewport", async () => {
  const other = "https://other.example/";
  const h = await setup({ [COLLECT_POINTS_KEY]: true, [SCROLL_POINTS_KEY]: { [page.url]: [100], [other]: [200] } }); h.activate();
  const cleared = await h.message({ type: "PAGE_CLEAR_POINTS" }, pageSender);
  assert.equal(cleared.count, 0); assert.deepEqual(h.preferences[SCROLL_POINTS_KEY], { [other]: [200] });
  const forbidden = await h.message({ type: "PAGE_SET_MODE", enabled: true }, { ...pageSender, tab: { id: 99 }, url: other });
  assert.equal(forbidden.ok, false); assert.equal(h.sessionStorage.viewportSession.mode, "desktop");
});
test("websites and subframes cannot invoke popup controls", async () => {
  const h = await setup({ [COLLECT_POINTS_KEY]: true }); h.activate();
  assert.equal(await h.message({ type: "SET_FULLSCREEN", enabled: false }, pageSender), undefined);
  assert.equal(await h.message({ type: "PAGE_SET_MODE", enabled: true }, { ...pageSender, frameId: 1 }), undefined);
  assert.equal(h.sessionStorage.viewportSession.phase, "active");
});

test("wide desktop views keep collection controls inside the visible part of the scaled page", async () => {
  const h = await setup({ [COLLECT_POINTS_KEY]: true });
  h.activate({ view: { width: 1920, height: 1080, scale: 1, visibleWidth: 1920, visibleHeight: 1080 } });
  h.window.width = 1440;
  const result = await h.message({ type: "PAGE_CONTROL_STATE" }, pageSender);
  assert.equal(result.state.controlsRightInset, 480);
});
