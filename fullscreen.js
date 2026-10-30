const target = session => ({ tabId: session.tabId });

async function evaluate(session, operation, userGesture = false) {
  const response = await chrome.debugger.sendCommand(target(session), "Runtime.evaluate", {
    expression: `(${operation.toString()})()`, awaitPromise: true,
    returnByValue: true, userGesture, timeout: 5000,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "The fullscreen request failed.");
  return response.result?.value;
}
async function requestPageFullscreen() {
  if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) throw new Error("Page fullscreen is unavailable on this page.");
  if (document.fullscreenElement !== document.documentElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  return Boolean(document.fullscreenElement);
}
function pageHasFullscreen() { return Boolean(document.fullscreenElement); }
async function leavePageFullscreen() {
  for (let attempt = 0; document.fullscreenElement && attempt < 5; attempt++) await document.exitFullscreen();
  return !document.fullscreenElement;
}

export async function waitForWindowState(windowId, state) {
  // windows.update can resolve before the macOS fullscreen animation and state
  // change complete. Stable page dimensions alone do not establish fullscreen.
  for (let attempt = 0; attempt <= 40; attempt++) {
    const bounds = await chrome.windows.get(windowId);
    if (bounds.state === state) return bounds;
    if (attempt < 40) await new Promise(resolve => setTimeout(resolve, 50));
  }
  return null;
}
export async function enterFullscreen(session, persist) {
  session.windowFullscreenRequested = true;
  session.fullscreenMethod = "window";
  await persist();
  let windowError;
  try {
    await chrome.windows.update(session.windowId, { state: "fullscreen" });
    if (await waitForWindowState(session.windowId, "fullscreen")) {
      session.fullscreenMethod = "window";
      return;
    }
  } catch (error) { windowError = error; }
  // Some Chromium browsers silently ignore fullscreen window updates. Cancel
  // any delayed window request before switching to the page's fullscreen API.
  try { await chrome.windows.update(session.windowId, { state: session.restoreState }); }
  catch { /* The page API can still enter fullscreen without a window update. */ }
  session.fullscreenMethod = "document";
  try {
    await persist();
    if (!await evaluate(session, requestPageFullscreen, true)) throw new Error("The page did not enter fullscreen.");
  } catch (error) {
    throw new Error(`Fullscreen was not accepted by this browser. ${error.message}${windowError ? ` Window request: ${windowError.message}` : ""}`);
  }
}
export async function isViewportFullscreen(session) {
  if (session.fullscreenMethod === "document") return Boolean(await evaluate(session, pageHasFullscreen));
  return (await chrome.windows.get(session.windowId)).state === "fullscreen";
}
export async function exitDocumentFullscreen(session) {
  if (session.fullscreenMethod !== "document") return;
  if (!await evaluate(session, leavePageFullscreen)) throw new Error("The page could not leave fullscreen.");
}
