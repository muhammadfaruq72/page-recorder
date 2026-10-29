export function recordingCursorStyle(sessionId) {
  // A unique stylesheet lets delayed cleanup from an older recording remove
  // only that recording's rules. USER origin also overrides inline site cursors.
  return `/* Page Recorder ${sessionId} */\n:root, *, *::before, *::after { cursor: none !important; }`;
}

export async function hideRecordingCursor(tabId, sessionId) {
  const css = recordingCursorStyle(sessionId);
  try {
    await chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, css, origin: "USER" });
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId }, css, origin: "USER" });
  }
}

export async function restoreRecordingCursor(status) {
  if (!Number.isInteger(status.tabId) || !status.cursorSessionId) return;
  const css = recordingCursorStyle(status.cursorSessionId);
  try {
    await chrome.scripting.removeCSS({ target: { tabId: status.tabId, allFrames: true }, css, origin: "USER" });
  } catch {
    try {
      await chrome.scripting.removeCSS({ target: { tabId: status.tabId }, css, origin: "USER" });
    } catch (error) {
      // Closed/navigated documents have already discarded their stylesheets.
      console.debug("Cursor cleanup:", error.message);
    }
  }
}
