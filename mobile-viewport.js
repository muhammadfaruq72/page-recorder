import { scaledOutputSize } from "./settings.js";

// Native viewport emulation operates on the original tab. Framing policies do
// not apply, and the browser window and the page's DOM remain in place.
const SESSION_KEY = "nativeMobileViewport";
const RESTORE_KEY = "nativeMobileViewportRestore";
const appliedSizes = new Map();

export async function mobileViewportSession() {
  return (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY];
}

function metrics(session, width, height) {
  const scale = Math.min(width / session.width, height / session.height);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("The tab's available size could not be read.");
  return {
    width: session.width, height: session.height, deviceScaleFactor: session.exportScale || 1,
    mobile: true, screenWidth: session.width, screenHeight: session.height,
    scale, dontSetVisibleSize: false,
  };
}

function viewport(session, available, scale) {
  return {
    width: available.width, height: available.height,
    mobile: {
      nativeSurface: true,
      width: session.width, height: session.height,
      ...scaledOutputSize(session.width, session.height, session.exportScale || 1),
      region: {
        left: 0, top: 0, width: session.width, height: session.height,
        viewportWidth: session.width, viewportHeight: session.height,
      },
    },
  };
}

export async function startMobileViewport(tab, settings, sessionId) {
  scaledOutputSize(settings.width, settings.height, settings.exportScale || 1);
  // Never take over another debugger or DevTools session.
  const session = { tabId: tab.id, windowId: tab.windowId, sessionId, width: settings.width, height: settings.height, exportScale: settings.exportScale, origin: new URL(tab.url).origin };
  const target = { tabId: tab.id };
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (error) {
    throw new Error(`Mobile mode could not connect to this tab. Close Inspect/DevTools or another debugger and try again. ${error.message}`);
  }
  try {
    const initialTab = await chrome.tabs.get(tab.id);
    const initialWindow = await chrome.windows.get(tab.windowId);
    session.frameInsets = { width: initialWindow.width - initialTab.width, height: initialWindow.height - initialTab.height };
    await chrome.storage.session.set({ [SESSION_KEY]: session });
    await chrome.debugger.sendCommand(target, "Page.enable");
    await chrome.debugger.sendCommand(target, "Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    return await refreshMobileViewport(session);
  } catch (error) {
    await closeMobileViewport({ tabId: tab.id, mobileSessionId: sessionId }).catch(() => {});
    // Also release ownership if persisting the session itself failed.
    try { await chrome.debugger.detach(target); } catch { /* Already detached. */ }
    throw error;
  }
}

export async function refreshMobileViewport(session, { settle = false } = {}) {
  let available = await chrome.tabs.get(session.tabId);
  if (settle) {
    // Sharing/debugging banners animate the tab's available height after media
    // acquisition. Wait for that browser-owned area, not emulated innerHeight.
    let stable = 0;
    const start = Date.now();
    while (Date.now() - start < 1500) {
      await new Promise(resolve => setTimeout(resolve, 50));
      const next = await chrome.tabs.get(session.tabId);
      stable = next.width === available.width && next.height === available.height ? stable + 1 : 0;
      available = next;
      if (stable >= 3 && Date.now() - start >= 250) break;
    }
  }
  // After setting a native mobile surface, tabs.get reports that emulated
  // surface rather than the browser container. Derive available space from
  // the unchanged window bounds so our own resize events cannot shrink it.
  if (session.frameInsets) {
    const bounds = await chrome.windows.get(session.windowId);
    available = { ...available, width: Math.max(1, bounds.width - session.frameInsets.width),
      height: Math.max(1, bounds.height - session.frameInsets.height) };
  }
  const override = metrics(session, available.width, available.height);
  const size = `${available.width}:${available.height}:${override.deviceScaleFactor}`;
  if (appliedSizes.get(session.sessionId) !== size) {
    appliedSizes.set(session.sessionId, size);
    try {
      await chrome.debugger.sendCommand({ tabId: session.tabId }, "Emulation.setDeviceMetricsOverride", override);
      await chrome.debugger.sendCommand({ tabId: session.tabId }, "Emulation.setVisibleSize", {
        width: Math.max(1, Math.round(session.width * override.scale)),
        height: Math.max(1, Math.round(session.height * override.scale)),
      });
    } catch (error) {
      appliedSizes.delete(session.sessionId);
      throw error;
    }
  }
  return viewport(session, available, Math.min(available.width / session.width, available.height / session.height));
}

export async function closeMobileViewport(status) {
  if (!Number.isInteger(status.tabId) || !status.mobileSessionId) return;
  const session = await mobileViewportSession();
  if (session?.tabId !== status.tabId || session.sessionId !== status.mobileSessionId) return;
  // Remove ownership first: our own detach must not be treated as a user cancel.
  await chrome.storage.session.remove(SESSION_KEY);
  appliedSizes.delete(session.sessionId);
  const target = { tabId: session.tabId };
  let restore = [];
  if (session.frameInsets) {
    try {
      const bounds = await chrome.windows.get(session.windowId);
      restore = [["Emulation.setVisibleSize", { width: Math.max(1, bounds.width - session.frameInsets.width),
        height: Math.max(1, bounds.height - session.frameInsets.height) }]];
    } catch { /* A closed browser window needs no visible-size restoration. */ }
  }
  for (const [method, params] of [
    ["Emulation.clearDeviceMetricsOverride", {}],
    ...restore,
    ["Emulation.setTouchEmulationEnabled", { enabled: false }],
  ]) {
    try { await chrome.debugger.sendCommand(target, method, params); }
    catch { /* A closed tab or detached debugger has already reset emulation. */ }
  }
  try { await chrome.debugger.detach(target); }
  catch { /* The browser can detach first (Stop debugging / closed tab). */ }
}

export async function forgetMobileViewport(tabId) {
  const session = await mobileViewportSession();
  if (session?.tabId !== tabId) return;
  await chrome.storage.session.remove(SESSION_KEY);
  appliedSizes.delete(session.sessionId);
  return session;
}

// Older Chromium builds clear device metrics on disconnection but retain the
// emulated surface size. Briefly reconnect only to restore the browser's own
// dimensions; never take over an existing debugger or restart capture.
export async function restoreDetachedMobileViewport(session) {
  if (!session?.frameInsets) return true;
  const target = { tabId: session.tabId };
  let attached = false;
  try {
    await chrome.tabs.get(session.tabId);
    const bounds = await chrome.windows.get(session.windowId);
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    await chrome.debugger.sendCommand(target, "Emulation.clearDeviceMetricsOverride", {});
    await chrome.debugger.sendCommand(target, "Emulation.setVisibleSize", {
      width: Math.max(1, bounds.width - session.frameInsets.width),
      height: Math.max(1, bounds.height - session.frameInsets.height),
    });
    await chrome.storage.session.remove(RESTORE_KEY);
    return true;
  } catch (error) {
    await chrome.storage.session.set({ [RESTORE_KEY]: session });
    console.debug("Mobile surface restoration:", error.message);
    return false;
  } finally {
    if (attached) { try { await chrome.debugger.detach(target); } catch { /* Browser detached first. */ } }
  }
}

export async function restorePendingMobileViewport(tabId) {
  const session = (await chrome.storage.session.get(RESTORE_KEY))[RESTORE_KEY];
  if (session?.tabId !== tabId) return;
  if (!await restoreDetachedMobileViewport(session)) {
    throw new Error("The previous mobile viewport needs restoration. Close Inspect or another debugger on this tab and click Page Recorder again.");
  }
}
