import { prepareRecordingWindow } from "./window-size.js";
import { loadScrollSettings, SCROLL_SETTINGS_KEY, loadMobileSettings } from "./settings.js";
import { scrollPage } from "./smooth-scroll.js";
import { recordingShortcuts } from "./recording-shortcuts.js";
import { startMobileViewport, refreshMobileViewport, closeMobileViewport, mobileViewportSession, forgetMobileViewport } from "./mobile-viewport.js";
import { hideRecordingCursor, restoreRecordingCursor } from "./recording-cursor.js";

const OFFSCREEN_URL = "offscreen.html";
let toggling = false;
let creatingDocument;
const recentScrollKeys = [];

async function stopMobileRecording(tabId, mobileSessionId, error) {
  if (!await hasRecorderDocument()) return;
  const { status } = await recorderMessage("STATUS");
  if (status.phase !== "recording" || status.tabId !== tabId || !status.mobileSessionId
    || (mobileSessionId && mobileSessionId !== status.mobileSessionId)) return;
  await cancelRecordedScroll(status);
  await recorderMessage("STOP", { error });
}

async function syncRecordedShortcuts(status) {
  if (!Number.isInteger(status.tabId) || !status.sessionId) return;
  const settings = await loadScrollSettings();
  try {
    await chrome.scripting.executeScript({
      target: { tabId: status.tabId },
      func: recordingShortcuts,
      args: [{
        action: status.phase === "recording" && settings.enabled ? "install" : "remove",
        sessionId: status.sessionId,
        commands: await chrome.commands.getAll(),
      }],
    });
  } catch (error) {
    // activeTab permission can end after navigation to a different origin.
    console.debug("Recording shortcuts:", error.message);
  }
}

async function refreshRecordedShortcuts(tabId) {
  if (!await hasRecorderDocument()) return;
  const { status } = await recorderMessage("STATUS");
  if (status.phase !== "recording" || status.tabId !== tabId) return;
  if (status.cursorSessionId) await hideRecordingCursor(tabId, status.cursorSessionId);
  if (status.mobileSessionId) {
    const session = await mobileViewportSession();
    if (session?.tabId === tabId && session.sessionId === status.mobileSessionId) {
      const viewport = await refreshMobileViewport(session);
      await recorderMessage("MOBILE_CROP", { mobileSessionId: session.sessionId, region: viewport.mobile.region });
    }
  }
  await syncRecordedShortcuts(status);
}

async function hasRecorderDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

async function ensureRecorderDocument() {
  if (await hasRecorderDocument()) return;
  if (!creatingDocument) {
    creatingDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA", "BLOBS"],
      justification: "Record the selected tab and save its video locally.",
    }).finally(() => { creatingDocument = undefined; });
  }
  await creatingDocument;
}

async function recorderMessage(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ target: "recorder", type, ...data });
  if (!response?.ok) throw new Error(response?.error || "The recorder did not respond. Try again.");
  return response;
}

async function cancelRecordedScroll(status) {
  if (!Number.isInteger(status.tabId) || !status.sessionId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: status.tabId },
      func: scrollPage,
      args: [{ action: "cancel", sessionId: status.sessionId }],
    });
  } catch (error) {
    // A closed or navigated tab has already destroyed its animation context.
    console.debug("Scroll cleanup:", error.message);
  }
}

export async function handleScrollCommand(command, input = {}) {
  const pageKey = input.source === "page" ? input : undefined;
  if (!["scroll-down", "scroll-up"].includes(command)) return;
  if (!pageKey && !(await chrome.windows.getLastFocused()).focused) return;
  const settings = await loadScrollSettings();
  if (!settings.enabled || !await hasRecorderDocument()) return;
  const { status } = await recorderMessage("STATUS");
  if (status.phase !== "recording" || !status.sessionId) return;
  if (pageKey && (pageKey.tabId !== status.tabId || pageKey.sessionId !== status.sessionId)) return;
  // Some browsers deliver both the native command and the same page key.
  // Pair only opposite sources, preserving separate rapid presses.
  const now = Date.now();
  while (recentScrollKeys.length && now - recentScrollKeys[0].time > 200) recentScrollKeys.shift();
  const source = pageKey ? "page" : "native";
  const duplicate = recentScrollKeys.findIndex(key => key.command === command && key.sessionId === status.sessionId && key.source !== source);
  if (duplicate !== -1) { recentScrollKeys.splice(duplicate, 1); return; }
  recentScrollKeys.push({ command, sessionId: status.sessionId, source, time: now });
  // Keep the old second-command ID so existing shortcut assignments survive.
  // Both shortcuts now move down; the second always uses a full viewport.
  const stepSettings = command === "scroll-up" ? { ...settings, stepPercent: 100 } : settings;
  // Arc may omit or report a different active tab in the native callback.
  await chrome.scripting.executeScript({
    target: { tabId: status.tabId },
    func: scrollPage,
    args: [{ action: "step", direction: 1, settings: stepSettings, sessionId: status.sessionId }],
  });
}

chrome.commands.onCommand.addListener(command => {
  return handleScrollCommand(command).catch(error => console.error("Smooth scrolling:", error));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SCROLL_SETTINGS_KEY]) return;
  return (async () => {
    if (!await hasRecorderDocument()) return;
    const { status } = await recorderMessage("STATUS");
    if (!changes[SCROLL_SETTINGS_KEY].newValue?.enabled) await cancelRecordedScroll(status);
    await syncRecordedShortcuts(status);
  })().catch(error => console.debug("Scroll switch cleanup:", error));
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "complete") return refreshRecordedShortcuts(tabId).catch(error => console.debug("Page shortcuts:", error.message));
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  return refreshRecordedShortcuts(tabId).catch(error => console.debug("Tab shortcuts:", error.message));
});

// The debugger API never opens Inspect. Losing the connection ends the
// recording and preserves the video instead of saving a desktop-sized view.
chrome.debugger.onDetach.addListener(source => {
  if (!Number.isInteger(source.tabId)) return;
  return (async () => {
    const session = await forgetMobileViewport(source.tabId);
    if (session) await stopMobileRecording(source.tabId, session.sessionId, "Mobile emulation was disconnected.");
  })().catch(error => console.debug("Mobile connection:", error.message));
});
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== "Page.frameNavigated" || params.frame.parentId) return;
  return (async () => {
    const session = await mobileViewportSession();
    if (session?.tabId !== source.tabId) return;
    const url = new URL(params.frame.url);
    // A different origin revokes activeTab access, including cursor hiding and
    // the page keyboard fallback. Save before recording an uncontrolled page.
    if (!/^(https?:|file:)$/.test(url.protocol) || url.origin !== session.origin) {
      await stopMobileRecording(source.tabId, session.sessionId, "The recorded tab navigated to a different website. Start a new recording there.");
    }
  })().catch(error => console.debug("Mobile navigation:", error.message));
});
chrome.windows.onBoundsChanged.addListener(window => {
  return (async () => {
    const session = await mobileViewportSession();
    if (session?.windowId === window.id) await refreshRecordedShortcuts(session.tabId);
  })().catch(error => console.debug("Mobile resize:", error.message));
});

export async function updateAction(status) {
  const phase = status.phase;
  const recording = phase === "recording";
  const busy = phase === "starting" || phase === "saving";
  const titles = {
    idle: "Page Recorder — click to record this tab",
    starting: "Page Recorder — starting recording…",
    recording: "Page Recorder — recording; click to stop and save",
    saving: "Page Recorder — saving video to Downloads…",
    error: `Page Recorder — ${status.error || "Recording failed."} ${status.retryAvailable ? "Click to retry saving." : "Click to try again."}`,
  };
  const icon = recording || busy ? "stop" : "record";
  await Promise.all([
    chrome.action.setIcon({ path: Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/${icon}-${size}.png`])) }),
    chrome.action.setTitle({ title: titles[phase] || titles.idle }),
    chrome.action.setBadgeText({ text: recording ? "REC" : busy ? "…" : phase === "error" ? "!" : "" }),
    chrome.action.setBadgeBackgroundColor({ color: phase === "error" ? "#b45309" : busy ? "#475569" : "#dc2626" }),
    chrome.action.setBadgeTextColor({ color: "#ffffff" }),
  ]);
}

export async function toggleRecording(tab) {
  const status = await hasRecorderDocument()
    ? (await recorderMessage("STATUS")).status
    : { phase: "idle" };

  // The same button stops the original tab even after the user changes tabs.
  if (status.phase === "recording") {
    await cancelRecordedScroll(status);
    await recorderMessage("STOP");
    return;
  }
  if (status.phase === "starting" || status.phase === "saving") return;
  if (status.retryAvailable) {
    await recorderMessage("RETRY_SAVE");
    return;
  }

  if (!tab?.id || !/^(https?:|file:)/i.test(tab.url || "")) {
    throw new Error("Open a regular webpage to start recording.");
  }

  await updateAction({ phase: "starting" });
  const mobile = await loadMobileSettings();
  const mobileSessionId = mobile.enabled ? crypto.randomUUID() : undefined;
  const cursorSessionId = crypto.randomUUID();
  try {
    let viewport;
    if (mobile.enabled) {
      viewport = await startMobileViewport(tab, mobile, mobileSessionId);
    } else {
      const resizedTab = await prepareRecordingWindow(tab);
      viewport = { width: resizedTab.width, height: resizedTab.height };
    }
    await hideRecordingCursor(tab.id, cursorSessionId);
    await ensureRecorderDocument();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await recorderMessage("START", { streamId, tabId: tab.id, viewport, cursorSessionId, ...(mobileSessionId ? { mobileSessionId } : {}) });
  } catch (error) {
    await restoreRecordingCursor({ tabId: tab.id, cursorSessionId });
    await closeMobileViewport({ tabId: tab.id, mobileSessionId });
    throw error;
  }
}

chrome.action.onClicked.addListener(tab => {
  // Lock synchronously so rapid clicks cannot open overlapping capture streams.
  if (toggling) return;
  toggling = true;
  toggleRecording(tab)
    .catch(error => {
      console.error("Page Recorder:", error);
      return updateAction({ phase: "error", error: error.message });
    })
    .finally(() => { toggling = false; });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.target !== "background") return;
  if (message.type === "SCROLL_KEY") {
    if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0) return;
    handleScrollCommand(message.command, { source: "page", tabId: sender.tab.id, sessionId: message.sessionId }).then(
      () => sendResponse({ ok: true }),
      error => sendResponse({ ok: false, error: error.message }),
    );
    return true;
  }
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  if (sender.url !== offscreenUrl) return;

  let operation;
  if (message.type === "STATUS_CHANGED") {
    operation = Promise.all([
      updateAction(message.status),
      syncRecordedShortcuts(message.status),
      message.status.phase === "recording" ? undefined : cancelRecordedScroll(message.status),
      ["saving", "idle", "error"].includes(message.status.phase) ? closeMobileViewport(message.status) : undefined,
      ["saving", "idle", "error"].includes(message.status.phase) ? restoreRecordingCursor(message.status) : undefined,
    ]).then(() => ({}));
  } else if (message.type === "DOWNLOAD") {
    // Blob URLs must belong to this extension's offscreen document.
    if (!message.url?.startsWith(`blob:chrome-extension://${chrome.runtime.id}/`)) return;
    operation = chrome.downloads.download({
      url: message.url,
      filename: message.filename,
      saveAs: false,
      conflictAction: "uniquify",
    }).then(downloadId => ({ downloadId }));
  } else if (message.type === "DOWNLOAD_STATUS") {
    operation = chrome.downloads.search({ id: message.downloadId }).then(([download]) => {
      if (!download) throw new Error("The download was removed.");
      return { state: download.state, error: download.error };
    });
  } else {
    return;
  }

  operation.then(
    result => sendResponse({ ok: true, ...result }),
    error => sendResponse({ ok: false, error: error.message }),
  );
  return true;
});

async function restoreAction() {
  try {
    const status = await hasRecorderDocument()
      ? (await recorderMessage("STATUS")).status
      : { phase: "idle" };
    if (!["recording", "starting"].includes(status.phase)) {
      const session = await mobileViewportSession();
      if (session) await closeMobileViewport({ tabId: session.tabId, mobileSessionId: session.sessionId });
    }
    await updateAction(status);
  } catch (error) {
    console.error("Could not restore recorder status:", error);
  }
}

chrome.runtime.onInstalled.addListener(restoreAction);
chrome.runtime.onStartup.addListener(restoreAction);
