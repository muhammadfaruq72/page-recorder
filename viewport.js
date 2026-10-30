// Emulate the original page, rather than embedding it or resizing its browser.
import { enterFullscreen, exitDocumentFullscreen, waitForWindowState } from "./fullscreen.js";
export const VIEWPORT_SESSION_KEY = "viewportSession";
const RESTORE_KEY = "viewportRestorePending";
const target = session => ({ tabId: session.tabId });
const send = (session, method, params = {}) => chrome.debugger.sendCommand(target(session), method, params);
export async function viewportSession() {
  return (await chrome.storage.session.get(VIEWPORT_SESSION_KEY))[VIEWPORT_SESSION_KEY];
}

async function settle(read) {
  let previous, stable = 0, value;
  // Fullscreen is an OS animation on macOS. Read the native page only before
  // emulation, and window bounds afterward; emulated innerWidth is not space.
  for (let attempt = 0; attempt < 40; attempt++) {
    value = await read();
    if (!Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width <= 0 || value.height <= 0) throw new Error("The browser viewport size is unavailable.");
    stable = previous?.width === value.width && previous?.height === value.height ? stable + 1 : 0;
    if (attempt >= 11 && stable >= 3) return value;
    previous = value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return value;
}
async function nativeSize(session) {
  const result = await send(session, "Runtime.evaluate", {
    expression: "({width: window.innerWidth, height: window.innerHeight})", returnByValue: true,
  });
  const size = result.result?.value;
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) throw new Error("The webpage viewport could not be read.");
  return size;
}

export function availableViewportSize(session, bounds) {
  // A browser using page fullscreen may keep reporting its old normal window
  // bounds, or update them later. Use the native page measurement captured
  // before emulation rather than letting those reports distort the preview.
  return session.fullscreenMethod === "document" && session.fullscreenSize || {
    width: Math.max(1, bounds.width - session.fullscreenInsets.width),
    height: Math.max(1, bounds.height - session.fullscreenInsets.height),
  };
}
export function fittedViewport(session, bounds) {
  const available = availableViewportSize(session, bounds);
  const width = session.settings.width;
  const height = session.settings.height;
  const scale = available.height / height;
  // Height is the anchor in both modes. Width follows the exact saved ratio;
  // a wide aspect may extend past the browser's right edge rather than shrink.
  return { width, height, scale, visibleWidth: Math.max(1, Math.round(width * scale)), visibleHeight: available.height };
}
export async function refreshViewport(session) {
  const bounds = await chrome.windows.get(session.windowId);
  const view = fittedViewport(session, bounds);
  const available = availableViewportSize(session, bounds);
  const surfaceWidth = Math.min(view.visibleWidth, available.width);
  if (JSON.stringify(session.view) === JSON.stringify(view) && session.surfaceWidth === surfaceWidth) return session;
  await send(session, "Emulation.setDeviceMetricsOverride", {
    width: view.width, height: view.height, deviceScaleFactor: 0,
    mobile: session.mode === "mobile", screenWidth: view.width, screenHeight: view.height,
    positionX: 0, positionY: 0, scale: view.scale, dontSetVisibleSize: false,
  });
  // The native page surface is anchored at the upper-left of the tab. Only
  // this surface changes size; the browser remains fullscreen.
  // Clip only the painted surface at the browser edge. The CSS layout and its
  // uniform height-based scale stay intact, without rendering hidden pixels.
  await send(session, "Emulation.setVisibleSize", { width: surfaceWidth, height: view.visibleHeight });
  session.view = view;
  session.surfaceWidth = surfaceWidth;
  await chrome.storage.session.set({ [VIEWPORT_SESSION_KEY]: session });
  return session;
}
export async function startViewport(tab, settings, mode) {
  const bounds = await chrome.windows.get(tab.windowId);
  const session = {
    tabId: tab.id, windowId: tab.windowId, sessionId: crypto.randomUUID(),
    origin: new URL(tab.url).origin, mode, settings, phase: "starting",
    restoreState: bounds.state === "maximized" ? "maximized" : "normal",
  };
  try { await chrome.debugger.attach(target(session), "1.3"); }
  catch (error) { throw new Error(`Close Inspect/DevTools or another debugger on this tab, then try again. ${error.message}`); }
  try {
    let originalBounds = bounds;
    // Even when activated from an already-fullscreen window, toggle-off must
    // exit fullscreen. Measure its normal page frame before entering the mode.
    if (bounds.state === "fullscreen") {
      await chrome.windows.update(tab.windowId, { state: "normal" });
      if (!await waitForWindowState(tab.windowId, "normal")) throw new Error("The browser did not leave its previous fullscreen state.");
      originalBounds = await settle(() => chrome.windows.get(tab.windowId));
    }
    const initial = await nativeSize(session);
    session.originalInsets = { width: Math.max(0, originalBounds.width - initial.width), height: Math.max(0, originalBounds.height - initial.height) };
    await chrome.storage.session.set({ [VIEWPORT_SESSION_KEY]: session });
    await enterFullscreen(session, () => chrome.storage.session.set({ [VIEWPORT_SESSION_KEY]: session }));
    const fullscreen = await settle(() => nativeSize(session));
    const fullBounds = await chrome.windows.get(tab.windowId);
    session.fullscreenSize = fullscreen;
    // Native window mode tracks the measured browser frame offset; page
    // fullscreen uses the cached native measurement above instead.
    session.fullscreenInsets = { width: fullBounds.width - fullscreen.width, height: fullBounds.height - fullscreen.height };
    await send(session, "Page.enable");
    await send(session, "Emulation.setTouchEmulationEnabled", { enabled: mode === "mobile", maxTouchPoints: 1 });
    session.phase = "active";
    return await refreshViewport(session);
  } catch (error) {
    await closeViewport(session).catch(() => {});
    throw error;
  }
}

export async function closeViewport(session, { detached = false, tabClosed = false } = {}) {
  // Our own detach must never trigger a second cleanup or a reconnection loop.
  await chrome.storage.session.remove(VIEWPORT_SESSION_KEY);
  let attached = !detached && !tabClosed;
  let failure;
  let tab;
  if (!tabClosed) { try { tab = await chrome.tabs.get(session.tabId); } catch { /* Closed tab. */ } }
  if (tab && session.fullscreenMethod === "document") {
    try {
      if (!attached) { await chrome.debugger.attach(target(session), "1.3"); attached = true; }
      await exitDocumentFullscreen(session);
    } catch (error) { failure = error; }
  }
  try {
    const bounds = await chrome.windows.get(session.windowId);
    if (session.windowFullscreenRequested || bounds.state === "fullscreen") {
      await chrome.windows.update(session.windowId, { state: session.restoreState });
      if (!await waitForWindowState(session.windowId, session.restoreState)) throw new Error("The previous browser window state was not restored.");
    }
  } catch (error) { if (tab) failure = error; }
  if (tab) {
    try {
      if (!attached) { await chrome.debugger.attach(target(session), "1.3"); attached = true; }
      const bounds = await settle(() => chrome.windows.get(tab.windowId));
      await send(session, "Emulation.clearDeviceMetricsOverride");
      await send(session, "Emulation.setTouchEmulationEnabled", { enabled: false });
      // Older Arc retains the native surface size after metrics are cleared.
      // Restore it explicitly before releasing the debugger.
      if (session.originalInsets) await send(session, "Emulation.setVisibleSize", {
        width: Math.max(1, bounds.width - session.originalInsets.width),
        height: Math.max(1, bounds.height - session.originalInsets.height),
      });
    } catch (error) { failure = error; }
  }
  if (attached) { try { await chrome.debugger.detach(target(session)); } catch { /* Browser detached first. */ } }
  if (failure) {
    await chrome.storage.session.set({ [RESTORE_KEY]: session });
    throw new Error(`Could not fully restore the viewport. Close Inspect/DevTools and click the toolbar button to retry. ${failure.message}`);
  }
  await chrome.storage.session.remove(RESTORE_KEY);
}
export async function restorePendingViewport() {
  const session = (await chrome.storage.session.get(RESTORE_KEY))[RESTORE_KEY];
  if (session) await closeViewport(session, { detached: true });
}
