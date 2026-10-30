import { COLLECT_POINTS_KEY, SCROLL_POINTS_KEY, SCROLL_SETTINGS_KEY, loadScrollSettings, loadMobileSettings, loadDesktopSettings, scrollPointsPageKey } from "./settings.js";
import { scrollPage } from "./smooth-scroll.js";
import { scrollShortcuts } from "./scroll-shortcuts.js";
import { startViewport, refreshViewport, closeViewport, viewportSession, restorePendingViewport, VIEWPORT_SESSION_KEY } from "./viewport.js";
import { isViewportFullscreen } from "./fullscreen.js";

let updates = Promise.resolve();
let pointWrites = Promise.resolve();
const recentScrollKeys = [];
function queue(operation) {
  const next = updates.catch(() => {}).then(operation);
  updates = next;
  return next;
}
function changePoints(operation) {
  const next = pointWrites.catch(() => {}).then(operation);
  pointWrites = next;
  return next;
}
async function report(error) {
  console.error("Page Viewport:", error);
  await updateAction({ phase: "error", error: error.message });
}
export async function updateAction(session = {}) {
  const active = session.phase === "active";
  const busy = ["starting", "stopping"].includes(session.phase);
  const titles = {
    active: `Page Viewport — ${session.mode} ${session.view?.width} × ${session.view?.height}; click to turn off`,
    starting: "Page Viewport — entering fullscreen…",
    stopping: "Page Viewport — restoring page…",
    error: `Page Viewport — ${session.error}. Click to try again.`,
    idle: "Page Viewport — click for fullscreen viewport and scrolling",
  };
  const icon = active || busy ? "stop" : "record";
  await Promise.all([
    chrome.action.setIcon({ path: Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/${icon}-${size}.png`])) }),
    chrome.action.setTitle({ title: titles[session.phase] || titles.idle }),
    chrome.action.setBadgeText({ text: active ? "ON" : busy ? "…" : session.phase === "error" ? "!" : "" }),
    chrome.action.setBadgeBackgroundColor({ color: session.phase === "error" ? "#b45309" : "#dc2630" }),
    chrome.action.setBadgeTextColor({ color: "#ffffff" }),
  ]);
}
async function cancelScroll(session) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: session.tabId }, func: scrollPage, args: [{ action: "cancel", sessionId: session.sessionId }] });
  } catch { /* A closed or navigated page has already discarded its animation. */ }
}
async function syncShortcuts(session) {
  const settings = await loadScrollSettings();
  try {
    await chrome.scripting.executeScript({
      target: { tabId: session.tabId }, func: scrollShortcuts,
      args: [{ action: session.phase === "active" ? "install" : "remove", sessionId: session.sessionId, documentFullscreen: session.fullscreenMethod === "document",
        commands: (await chrome.commands.getAll()).filter(command => settings.enabled || command.name === "scroll-next-point") }],
    });
  } catch (error) { console.debug("Page shortcuts:", error.message); }
}
async function stopSession(session, options) {
  session.phase = "stopping";
  await chrome.storage.session.set({ [VIEWPORT_SESSION_KEY]: session });
  await updateAction(session);
  await cancelScroll(session);
  await syncShortcuts(session);
  try { await closeViewport(session, options); }
  finally {
    recentScrollKeys.length = 0;
    await chrome.storage.session.remove("scrollPointSequence");
    void syncPointCollectors(session.tabId).catch(() => {});
  }
  await updateAction();
}
export async function toggleViewport(tab) {
  const session = await viewportSession();
  // The same button turns off the original session even from a different tab.
  if (session) return stopSession(session);
  if (!Number.isInteger(tab?.id) || !/^(https?:|file:)/i.test(tab.url || "")) throw new Error("Open a regular webpage to use the viewport toggle");
  await updateAction({ phase: "starting" });
  try {
    // Remove an existing collector before fullscreen or viewport work begins.
    // Its cleanup also invalidates pending refreshes that could recreate it.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id }, injectImmediately: true,
      func: () => { globalThis.__pageRecorderPointCollector?.remove(); },
    });
    await restorePendingViewport();
    const mobile = await loadMobileSettings();
    const settings = mobile.enabled ? { width: mobile.width, height: mobile.height } : await loadDesktopSettings();
    const active = await startViewport(tab, settings, mobile.enabled ? "mobile" : "desktop");
    // Replacing the collector removes its button immediately; the new instance
    // reads this tab's active session and keeps it hidden until toggle-off.
    await syncPointCollectors(active.tabId);
    await chrome.storage.session.remove("scrollPointSequence");
    await syncShortcuts(active);
    await updateAction(active);
  } catch (error) {
    const active = await viewportSession();
    if (active) await stopSession(active).catch(() => {});
    else void syncPointCollectors(tab.id).catch(() => {});
    throw error;
  }
}
chrome.action.onClicked.addListener(tab => queue(() => toggleViewport(tab)).catch(report));

async function scrollNextPoint(session, settings) {
  const tab = await chrome.tabs.get(session.tabId);
  const url = scrollPointsPageKey(tab.url);
  let { scrollPointSequence: sequence } = await chrome.storage.session.get("scrollPointSequence");
  if (sequence?.sessionId !== session.sessionId || sequence.url !== url) {
    const saved = await chrome.storage.local.get(SCROLL_POINTS_KEY);
    sequence = { sessionId: session.sessionId, url, index: 0, points: saved[SCROLL_POINTS_KEY]?.[url] || [] };
  }
  if (sequence.index >= sequence.points.length) return;
  await chrome.scripting.executeScript({ target: { tabId: session.tabId }, func: scrollPage,
    args: [{ action: "point", top: sequence.points[sequence.index], settings, sessionId: session.sessionId }] });
  sequence.index++;
  await chrome.storage.session.set({ scrollPointSequence: sequence });
}
export function handleScrollCommand(command, input = {}) {
  return queue(async () => {
    if (!["scroll-down", "scroll-up", "scroll-next-point"].includes(command)) return;
    const pageKey = input.source === "page";
    if (!pageKey && !(await chrome.windows.getLastFocused()).focused) return;
    const session = await viewportSession();
    if (session?.phase !== "active") return;
    if (pageKey && (input.tabId !== session.tabId || input.sessionId !== session.sessionId)) return;
    const settings = await loadScrollSettings();
    if (!settings.enabled && command !== "scroll-next-point") return;
    // Arc can deliver the same key through both routes. Pair opposite sources
    // only, keeping distinct rapid presses and all queued scrolling steps.
    const now = Date.now(), source = pageKey ? "page" : "native";
    while (recentScrollKeys.length && now - recentScrollKeys[0].time > 200) recentScrollKeys.shift();
    const duplicate = recentScrollKeys.findIndex(key => key.command === command && key.sessionId === session.sessionId && key.source !== source);
    if (duplicate !== -1) { recentScrollKeys.splice(duplicate, 1); return; }
    recentScrollKeys.push({ command, sessionId: session.sessionId, source, time: now });
    if (command === "scroll-next-point") return scrollNextPoint(session, settings);
    // Preserve the old command ID so the user's full-height shortcut survives.
    const stepSettings = command === "scroll-up" ? { ...settings, stepPercent: 100 } : settings;
    await chrome.scripting.executeScript({ target: { tabId: session.tabId }, func: scrollPage,
      args: [{ action: "step", direction: 1, settings: stepSettings, sessionId: session.sessionId }] });
  });
}
chrome.commands.onCommand.addListener(command => handleScrollCommand(command).catch(error => console.error("Smooth scrolling:", error)));

async function syncPointCollectors(tabId) {
  if (!(await chrome.storage.local.get(COLLECT_POINTS_KEY))[COLLECT_POINTS_KEY]) return;
  if (!await chrome.permissions.contains({ origins: ["http://*/*", "https://*/*"] })) return;
  const tabs = Number.isInteger(tabId) ? [await chrome.tabs.get(tabId)] : await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(tab => /^https?:/.test(tab.url || "")).map(tab =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["scroll-point-collector.js"], injectImmediately: true })));
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[COLLECT_POINTS_KEY]) void syncPointCollectors().catch(error => console.debug("Scroll points:", error.message));
  if (changes[SCROLL_SETTINGS_KEY]) return queue(async () => {
    const session = await viewportSession();
    if (!session) return;
    if (!changes[SCROLL_SETTINGS_KEY].newValue?.enabled) await cancelScroll(session);
    await syncShortcuts(session);
  }).catch(report);
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== "complete") return;
  void syncPointCollectors(tabId).catch(() => {});
  return queue(async () => {
    const session = await viewportSession();
    if (session?.tabId !== tabId || session.phase !== "active") return;
    if (!await isViewportFullscreen(session)) return stopSession(session);
    await refreshViewport(session);
    await syncShortcuts(session);
  }).catch(report);
});
chrome.tabs.onActivated.addListener(({ tabId }) => queue(async () => {
  const session = await viewportSession();
  if (session?.tabId === tabId && session.phase === "active") await syncShortcuts(session);
}).catch(report));
chrome.tabs.onRemoved.addListener(tabId => queue(async () => {
  const session = await viewportSession();
  if (session?.tabId === tabId) await stopSession(session, { tabClosed: true });
}).catch(report));
chrome.debugger.onDetach.addListener((source, reason) => queue(async () => {
  const session = await viewportSession();
  if (session?.tabId === source.tabId) await stopSession(session, { detached: true, tabClosed: reason === "target_closed" });
}).catch(report));
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== "Page.frameNavigated" || params.frame.parentId) return;
  return queue(async () => {
    const session = await viewportSession();
    if (session?.tabId !== source.tabId) return;
    const url = new URL(params.frame.url);
    // Cross-origin navigation can revoke activeTab access to page shortcuts.
    if (!/^(https?:|file:)$/.test(url.protocol) || url.origin !== session.origin) await stopSession(session);
  }).catch(report);
});
chrome.windows.onBoundsChanged.addListener(bounds => queue(async () => {
  const session = await viewportSession();
  if (session?.windowId !== bounds.id || session.phase !== "active") return;
  // Escape/manual fullscreen exit turns the mode off instead of forcing it back.
  if (!await isViewportFullscreen(session)) return stopSession(session);
  await refreshViewport(session);
  await updateAction(session);
}).catch(report));

function optionsSender(sender) {
  try { const url = new URL(sender.url); url.search = ""; url.hash = ""; return url.href === chrome.runtime.getURL("options.html"); }
  catch { return false; }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.target !== "background") return;
  let operation;
  if (message.type === "POINT_COLLECTION_STATE") {
    if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0) return;
    operation = viewportSession().then(session => ({ suspended: session?.tabId === sender.tab.id }));
  } else if (message.type === "COLLECT_POINT") {
    if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0 || !/^https?:/.test(sender.url || "")) return;
    operation = changePoints(async () => {
      const saved = await chrome.storage.local.get([COLLECT_POINTS_KEY, SCROLL_POINTS_KEY]);
      if (!saved[COLLECT_POINTS_KEY]) throw new Error("Turn on Collect scroll points in settings first.");
      if (!Number.isSafeInteger(message.top) || message.top < 0) throw new Error("Invalid scroll position.");
      const url = scrollPointsPageKey(sender.url), pages = saved[SCROLL_POINTS_KEY] || {};
      const points = pages[url] || [];
      if (points.at(-1) !== message.top) points.push(message.top);
      pages[url] = points;
      await chrome.storage.local.set({ [SCROLL_POINTS_KEY]: pages });
      return { count: points.length };
    });
  } else if (message.type === "CLEAR_SCROLL_POINTS" && optionsSender(sender)) {
    operation = changePoints(() => queue(async () => {
      await chrome.storage.local.set({ [SCROLL_POINTS_KEY]: {} });
      await chrome.storage.session.remove("scrollPointSequence");
    }));
  } else if (message.type === "SCROLL_KEY") {
    if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0) return;
    operation = handleScrollCommand(message.command, { source: "page", tabId: sender.tab.id, sessionId: message.sessionId });
  } else if (message.type === "VIEWPORT_FULLSCREEN_EXIT") {
    if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0) return;
    operation = queue(async () => {
      const session = await viewportSession();
      if (session?.phase !== "active" || session.fullscreenMethod !== "document" || session.tabId !== sender.tab.id || session.sessionId !== message.sessionId) return;
      // Recheck the browser state; page code cannot end a different session.
      if (!await isViewportFullscreen(session)) await stopSession(session);
    });
  } else return;
  operation.then(result => sendResponse({ ok: true, ...result }), error => sendResponse({ ok: false, error: error.message }));
  return true;
});
async function initialize() {
  await loadDesktopSettings();
  // Remove obsolete preferences; existing points, dimensions and bindings stay.
  await chrome.storage.local.remove("recordingOutputSettings");
  await chrome.storage.session.remove("pointCollectionSuspended");
  const session = await viewportSession();
  if (session) await stopSession(session, { detached: true });
  else await updateAction();
  void syncPointCollectors().catch(() => {});
}
chrome.runtime.onInstalled.addListener(() => queue(initialize).catch(report));
chrome.runtime.onStartup.addListener(() => queue(initialize).catch(report));
