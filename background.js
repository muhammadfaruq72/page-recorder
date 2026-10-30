import { COLLECT_POINTS_KEY, SCROLL_POINTS_KEY, SCROLL_SETTINGS_KEY, loadScrollSettings, loadMobileSettings, saveMobileSettings, loadDesktopSettings, scrollPointsPageKey } from "./settings.js";
import { scrollPage } from "./smooth-scroll.js";
import { scrollShortcuts } from "./scroll-shortcuts.js";
import { startViewport, refreshViewport, closeViewport, viewportSession, restorePendingViewport, availableViewportSize, VIEWPORT_SESSION_KEY } from "./viewport.js";
import { isViewportFullscreen } from "./fullscreen.js";

let updates = Promise.resolve();
const recentScrollKeys = [];
function queue(operation) {
  const next = updates.catch(() => {}).then(operation);
  updates = next;
  return next;
}
async function report(error) {
  console.error("Page Viewport:", error);
  await updateAction({ phase: "error", error: error.message });
}
export async function updateAction(session = {}) {
  const active = session.phase === "active";
  const busy = ["starting", "switching", "stopping"].includes(session.phase);
  const titles = {
    active: `Page Viewport — ${session.mode} ${session.view?.width} × ${session.view?.height}; open controls`,
    starting: "Page Viewport — entering fullscreen…",
    switching: "Page Viewport — changing viewport…",
    stopping: "Page Viewport — restoring page…",
    error: `Page Viewport — ${session.error}. Click to try again.`,
    idle: "Page Viewport — open controls",
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
    await restorePendingViewport();
    const mobile = await loadMobileSettings();
    const settings = mobile.enabled ? { width: mobile.width, height: mobile.height } : await loadDesktopSettings();
    const active = await startViewport(tab, settings, mobile.enabled ? "mobile" : "desktop");
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

export async function setViewportMode(enabled) {
  if (typeof enabled !== "boolean") throw new Error("Choose desktop or mobile mode.");
  const mobile = await loadMobileSettings();
  const mode = enabled ? "mobile" : "desktop";
  const session = await viewportSession();
  if (!session) { await saveMobileSettings({ ...mobile, enabled }); return; }
  if (session.phase !== "active") throw new Error("Wait for the viewport to finish changing.");
  if (session.mode === mode) { await saveMobileSettings({ ...mobile, enabled }); return; }
  const previous = structuredClone(session);
  const settings = enabled ? { width: mobile.width, height: mobile.height } : await loadDesktopSettings();
  await cancelScroll(session);
  try {
    session.phase = "switching";
    await chrome.storage.session.set({ [VIEWPORT_SESSION_KEY]: session });
    await updateAction(session);
    session.mode = mode;
    session.settings = settings;
    delete session.view; // Apply the mode even if both saved dimensions match.
    await chrome.debugger.sendCommand({ tabId: session.tabId }, "Emulation.setTouchEmulationEnabled", { enabled, maxTouchPoints: 1 });
    await refreshViewport(session);
    await saveMobileSettings({ ...mobile, enabled });
    await chrome.storage.session.remove("scrollPointSequence");
    recentScrollKeys.length = 0;
    session.phase = "active";
    await chrome.storage.session.set({ [VIEWPORT_SESSION_KEY]: session });
    await syncShortcuts(session);
    await syncPointCollectors(session.tabId);
    await updateAction(session);
  } catch (error) {
    try {
      delete previous.view;
      await chrome.debugger.sendCommand({ tabId: previous.tabId }, "Emulation.setTouchEmulationEnabled", { enabled: previous.mode === "mobile", maxTouchPoints: 1 });
      await refreshViewport(previous);
      await saveMobileSettings(mobile);
      await syncPointCollectors(previous.tabId);
      await updateAction(previous);
    } catch { await stopSession(previous).catch(() => {}); }
    throw error;
  }
}
async function savePoint(url, top) {
  const saved = await chrome.storage.local.get([COLLECT_POINTS_KEY, SCROLL_POINTS_KEY]);
  if (!saved[COLLECT_POINTS_KEY]) throw new Error("Turn on Collect scroll points first.");
  if (!Number.isSafeInteger(top) || top < 0) throw new Error("Invalid scroll position.");
  const key = scrollPointsPageKey(url), pages = saved[SCROLL_POINTS_KEY] || {};
  const points = pages[key] || [];
  if (points.at(-1) !== top) points.push(top);
  pages[key] = points;
  await chrome.storage.local.set({ [SCROLL_POINTS_KEY]: pages });
  // Points added during fullscreen remain available after playback has begun.
  const { scrollPointSequence: sequence } = await chrome.storage.session.get("scrollPointSequence");
  if (sequence?.url === key) await chrome.storage.session.set({ scrollPointSequence: { ...sequence, points } });
  return { count: points.length, top };
}
async function clearPagePoints(url) {
  const key = scrollPointsPageKey(url);
  const saved = await chrome.storage.local.get(SCROLL_POINTS_KEY);
  const pages = saved[SCROLL_POINTS_KEY] || {};
  delete pages[key];
  const session = await viewportSession();
  const activeTab = session ? await chrome.tabs.get(session.tabId).catch(() => undefined) : undefined;
  if (activeTab?.url && scrollPointsPageKey(activeTab.url) === key) {
    await cancelScroll(session);
    await chrome.storage.session.remove("scrollPointSequence");
  }
  await chrome.storage.local.set({ [SCROLL_POINTS_KEY]: pages });
  return { count: 0 };
}
async function controlState(tabId, { preferSession = false, url } = {}) {
  const session = await viewportSession();
  const mobile = await loadMobileSettings();
  const saved = await chrome.storage.local.get([COLLECT_POINTS_KEY, SCROLL_POINTS_KEY]);
  if (preferSession && session) tabId = session.tabId;
  let tab;
  if (Number.isInteger(tabId)) { try { tab = await chrome.tabs.get(tabId); } catch { /* Closed tab. */ } }
  const pageUrl = url || tab?.url;
  const supported = /^(https?:|file:)/i.test(pageUrl || "");
  const key = supported ? scrollPointsPageKey(pageUrl) : undefined;
  const ownsSession = !!session && session.tabId === tabId;
  let controlsRightInset = 0;
  if (ownsSession && session.view?.scale > 0) {
    const available = availableViewportSize(session, await chrome.windows.get(session.windowId));
    controlsRightInset = Math.max(0, session.view.width - available.width / session.view.scale);
  }
  return {
    tabId, url: key, supported, fullscreen: !!session && (preferSession || ownsSession),
    active: ownsSession && session?.phase === "active", busy: !!session && session.phase !== "active",
    otherActive: !!session && !ownsSession, sessionId: ownsSession ? session?.sessionId : undefined,
    mobile: ownsSession ? session.mode === "mobile" : mobile.enabled,
    width: ownsSession ? session.view?.width : undefined, height: ownsSession ? session.view?.height : undefined,
    controlsRightInset,
    collectionEnabled: !!saved[COLLECT_POINTS_KEY], count: key ? saved[SCROLL_POINTS_KEY]?.[key]?.length || 0 : 0,
  };
}

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
  if ((await chrome.storage.local.get(COLLECT_POINTS_KEY))[COLLECT_POINTS_KEY]) {
    await chrome.scripting.executeScript({ target: { tabId: session.tabId }, func: () => { void globalThis.__pageRecorderPointCollector?.refresh?.(); } });
  }
  await updateAction(session);
}).catch(report));

function extensionPage(sender, path) {
  try { const url = new URL(sender.url); url.search = ""; url.hash = ""; return url.href === chrome.runtime.getURL(path); }
  catch { return false; }
}
function pageSender(sender) {
  return Number.isInteger(sender.tab?.id) && sender.frameId === 0 && /^https?:/.test(sender.url || "");
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.target !== "background") return;
  let operation;
  if (message.type === "POPUP_STATE" && extensionPage(sender, "popup.html")) {
    operation = controlState(message.tabId, { preferSession: true }).then(state => ({ state }));
  } else if (["SET_FULLSCREEN", "SET_MODE", "SET_COLLECTION", "CLEAR_PAGE_POINTS"].includes(message.type) && extensionPage(sender, "popup.html")) {
    operation = queue(async () => {
      if (message.type !== "CLEAR_PAGE_POINTS" && typeof message.enabled !== "boolean") throw new Error("Choose on or off.");
      const session = await viewportSession();
      const tabId = session?.tabId ?? message.tabId;
      if (message.type === "SET_FULLSCREEN") {
        if (message.enabled && !session) await toggleViewport(await chrome.tabs.get(tabId));
        else if (!message.enabled && session) await stopSession(session);
      } else if (message.type === "SET_MODE") await setViewportMode(message.enabled);
      else if (message.type === "SET_COLLECTION") {
        if (message.enabled && !await chrome.permissions.contains({ origins: ["http://*/*", "https://*/*"] })) throw new Error("Allow website access to show the page buttons.");
        await chrome.storage.local.set({ [COLLECT_POINTS_KEY]: message.enabled });
        // Target this tab synchronously. Other loading tabs must not block UI.
        if (Number.isInteger(tabId)) await syncPointCollectors(tabId);
      } else await clearPagePoints((await chrome.tabs.get(tabId)).url);
      return { state: await controlState(message.tabId, { preferSession: true }) };
    }).catch(async error => {
      if (message.type === "SET_FULLSCREEN") await updateAction({ phase: "error", error: error.message });
      throw error;
    });
  } else if (message.type === "PAGE_CONTROL_STATE" && pageSender(sender)) {
    operation = controlState(sender.tab.id, { url: sender.url }).then(state => ({ state }));
  } else if (["COLLECT_POINT", "PAGE_CLEAR_POINTS", "PAGE_SET_MODE"].includes(message.type) && pageSender(sender)) {
    operation = queue(async () => {
      if (!(await chrome.storage.local.get(COLLECT_POINTS_KEY))[COLLECT_POINTS_KEY]) throw new Error("Turn on Collect scroll points first.");
      if (message.type === "COLLECT_POINT") return savePoint(sender.url, message.top);
      if (message.type === "PAGE_CLEAR_POINTS") return clearPagePoints(sender.url);
      const session = await viewportSession();
      if (session && session.tabId !== sender.tab.id) throw new Error("Switch modes in the active viewport tab.");
      await setViewportMode(message.enabled);
      return { state: await controlState(sender.tab.id, { url: sender.url }) };
    });
  } else if (message.type === "CLEAR_SCROLL_POINTS" && extensionPage(sender, "options.html")) {
    operation = queue(async () => {
      const session = await viewportSession();
      if (session) await cancelScroll(session);
      await chrome.storage.local.set({ [SCROLL_POINTS_KEY]: {} });
      await chrome.storage.session.remove("scrollPointSequence");
    });
  } else if (message.type === "SCROLL_KEY") {
    if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0) return;
    operation = handleScrollCommand(message.command, { source: "page", tabId: sender.tab.id, sessionId: message.sessionId });
  } else if (message.type === "VIEWPORT_FULLSCREEN_EXIT") {
    if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0) return;
    operation = queue(async () => {
      const session = await viewportSession();
      if (session?.phase !== "active" || session.fullscreenMethod !== "document" || session.tabId !== sender.tab.id || session.sessionId !== message.sessionId) return;
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
