import { PageRecorder } from "./recorder.js";
import { createRecordingFile } from "./recording-file.js";
import { prepareRecordingVideo, sourceCropRect } from "./cropped-video.js";

let recordingContext = {};
const withRecordingContext = status => ({ ...status, ...recordingContext });

async function backgroundMessage(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ target: "background", type, ...data });
  if (!response?.ok) throw new Error(response?.error || "The extension did not respond.");
  return response;
}

const recorder = new PageRecorder({
  getMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
  MediaRecorderClass: MediaRecorder,
  createFile: createRecordingFile,
  prepareVideo: prepareRecordingVideo,
  onStatus: status => backgroundMessage("STATUS_CHANGED", { status: withRecordingContext(status) }),
  download: async (url, filename) => {
    const { downloadId } = await backgroundMessage("DOWNLOAD", { url, filename });
    // Keep the file and its blob URL alive until Chrome has copied every byte.
    for (;;) {
      const result = await backgroundMessage("DOWNLOAD_STATUS", { downloadId });
      if (result.state === "complete") return;
      if (result.state === "interrupted") {
        throw new Error(`Download interrupted (${result.error || "unknown reason"}).`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  },
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.target !== "recorder") return;

  let operation;
  switch (message.type) {
    case "STATUS":
      sendResponse({ ok: true, status: withRecordingContext(recorder.status) });
      return;
    case "START":
      recordingContext = { tabId: message.tabId, sessionId: crypto.randomUUID(), cursorSessionId: message.cursorSessionId, ...(message.mobileSessionId ? { mobileSessionId: message.mobileSessionId } : {}) };
      operation = recorder.start(message.streamId, message.tabId, {
        ...message.viewport,
        devicePixelRatio: window.devicePixelRatio || 1,
      });
      break;
    case "MOBILE_CROP":
      if (sender.url !== chrome.runtime.getURL("background.js") || message.mobileSessionId !== recordingContext.mobileSessionId || !recorder.mobileCrop) return;
      try { sourceCropRect(message.region, 1, 1); } catch { sendResponse({ ok: false }); return; }
      recorder.mobileCrop.region = message.region;
      sendResponse({ ok: true });
      return;
    case "STOP":
      recorder.stop(message.error);
      sendResponse({ ok: true });
      return;
    case "RETRY_SAVE":
      // Saving continues independently of the service worker's lifetime.
      void recorder.retrySave();
      sendResponse({ ok: true });
      return;
    default:
      return;
  }

  operation.then(
    () => sendResponse({ ok: true }),
    error => sendResponse({ ok: false, error: error.message }),
  );
  return true;
});
