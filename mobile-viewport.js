import { scaledOutputSize } from "./settings.js";

// Native viewport emulation operates on the original tab. Framing policies do
// not apply, and the browser window and the page's DOM remain in place.
const SESSION_KEY = "nativeMobileViewport";
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
    scale, dontSetVisibleSize: true,
  };
}

function viewport(session, available, scale) {
  return {
    width: available.width, height: available.height,
    mobile: {
      width: session.width, height: session.height,
      ...scaledOutputSize(session.width, session.height, session.exportScale || 1),
      region: {
        left: 0, top: 0, width: session.width * scale, height: session.height * scale,
        viewportWidth: available.width, viewportHeight: available.height,
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
  const override = metrics(session, available.width, available.height);
  const size = `${available.width}:${available.height}:${override.deviceScaleFactor}`;
  if (appliedSizes.get(session.sessionId) !== size) {
    appliedSizes.set(session.sessionId, size);
    try {
      await chrome.debugger.sendCommand({ tabId: session.tabId }, "Emulation.setDeviceMetricsOverride", override);
    } catch (error) {
      appliedSizes.delete(session.sessionId);
      throw error;
    }
  }
  return viewport(session, available, override.scale);
}

export async function closeMobileViewport(status) {
  if (!Number.isInteger(status.tabId) || !status.mobileSessionId) return;
  const session = await mobileViewportSession();
  if (session?.tabId !== status.tabId || session.sessionId !== status.mobileSessionId) return;
  // Remove ownership first: our own detach must not be treated as a user cancel.
  await chrome.storage.session.remove(SESSION_KEY);
  appliedSizes.delete(session.sessionId);
  const target = { tabId: session.tabId };
  for (const [method, params] of [
    ["Emulation.clearDeviceMetricsOverride", {}],
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
