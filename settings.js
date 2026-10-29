export const WINDOW_WIDTH_KEY = "recordingWindowWidth";
export const LEGACY_WINDOW_SIZE_KEY = "recordingWindowSize";
export const SCROLL_SETTINGS_KEY = "smoothScrollSettings";
export const MOBILE_SETTINGS_KEY = "mobileViewportSettings";
export const OUTPUT_SETTINGS_KEY = "recordingOutputSettings";
export const RECORDING_FRAME_RATES = Object.freeze([15, 24, 25, 30, 50, 60, 120]);
export const DEFAULT_OUTPUT_SETTINGS = Object.freeze({
  exportScale: 3, cursorVisible: true, frameRate: 60,
  bitrateMode: "auto", bitrateMbps: 30, codec: "auto",
  startDelayMs: 0, maxDurationSeconds: 0, filenamePrefix: "recording",
});
export const DEFAULT_MOBILE_SETTINGS = Object.freeze({ enabled: false, width: 390, height: 844 });
export const DEFAULT_SCROLL_SETTINGS = Object.freeze({
  enabled: false,
  easing: "smootherstep",
  durationMs: 1500,
  stepPercent: 30,
});
export const SCROLL_EASINGS = ["smootherstep", "ease-in-out-sine", "ease-out-cubic", "linear"];

export function validateWindowWidth(width) {
  if (!Number.isInteger(width) || width < 100 || width > 16384) {
    throw new Error("Enter a whole-number width between 100 and 16,384 pixels.");
  }
  return width;
}

export async function loadWindowWidth() {
  const settings = await chrome.storage.local.get([WINDOW_WIDTH_KEY, LEGACY_WINDOW_SIZE_KEY]);
  if (settings[WINDOW_WIDTH_KEY] != null) return validateWindowWidth(settings[WINDOW_WIDTH_KEY]);
  // Preserve the user's existing width when upgrading; the old height is discarded.
  const legacyWidth = settings[LEGACY_WINDOW_SIZE_KEY]?.width;
  return legacyWidth == null ? null : saveWindowWidth(legacyWidth);
}

export async function saveWindowWidth(width) {
  const validated = validateWindowWidth(width);
  await chrome.storage.local.set({ [WINDOW_WIDTH_KEY]: validated });
  await chrome.storage.local.remove(LEGACY_WINDOW_SIZE_KEY);
  return validated;
}

export function validateScrollSettings(settings) {
  const { enabled, easing, durationMs, stepPercent } = settings || {};
  if (typeof enabled !== "boolean") throw new Error("Choose whether scroll shortcuts are enabled.");
  if (!SCROLL_EASINGS.includes(easing)) throw new Error("Choose a supported scrolling transition.");
  if (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > 60000) {
    throw new Error("Animation duration must be between 0.1 and 60 seconds.");
  }
  if (!Number.isFinite(stepPercent) || stepPercent < 0.1 || stepPercent > 100) {
    throw new Error("Scroll distance must be between 0.1% and 100% of the visible page height.");
  }
  return { enabled, easing, durationMs, stepPercent };
}

export async function loadScrollSettings() {
  const saved = await chrome.storage.local.get(SCROLL_SETTINGS_KEY);
  return validateScrollSettings({ ...DEFAULT_SCROLL_SETTINGS, ...saved[SCROLL_SETTINGS_KEY] });
}

export async function saveScrollSettings(settings) {
  const validated = validateScrollSettings(settings);
  await chrome.storage.local.set({ [SCROLL_SETTINGS_KEY]: validated });
  return validated;
}

export function validateMobileSettings(settings) {
  const { enabled, width, height } = settings || {};
  if (typeof enabled !== "boolean") throw new Error("Choose whether mobile mode is enabled.");
  for (const [name, value] of [["width", width], ["height", height]]) {
    if (!Number.isInteger(value) || value < 100 || value > 4096) {
      throw new Error(`Mobile ${name} must be a whole number between 100 and 4,096 pixels.`);
    }
  }
  return { enabled, width, height };
}

export async function loadMobileSettings() {
  const saved = await chrome.storage.local.get(MOBILE_SETTINGS_KEY);
  return validateMobileSettings({ ...DEFAULT_MOBILE_SETTINGS, ...saved[MOBILE_SETTINGS_KEY] });
}

export async function saveMobileSettings(settings) {
  const validated = validateMobileSettings(settings);
  await chrome.storage.local.set({ [MOBILE_SETTINGS_KEY]: validated });
  return validated;
}

export function validateOutputSettings(settings) {
  const { exportScale, cursorVisible, frameRate, bitrateMode, bitrateMbps, codec, startDelayMs, maxDurationSeconds, filenamePrefix } = { ...DEFAULT_OUTPUT_SETTINGS, ...settings };
  if (!Number.isInteger(exportScale) || exportScale < 1 || exportScale > 3) {
    throw new Error("Choose an output quality of 1×, 2×, or 3×.");
  }
  if (typeof cursorVisible !== "boolean") throw new Error("Choose whether the cursor is visible.");
  if (!RECORDING_FRAME_RATES.includes(frameRate)) throw new Error("Choose a supported recording frame rate.");
  if (!["auto", "custom"].includes(bitrateMode)) throw new Error("Choose automatic or custom bitrate.");
  if (!Number.isInteger(bitrateMbps) || bitrateMbps < 1 || bitrateMbps > 200) {
    throw new Error("Custom bitrate must be a whole number between 1 and 200 Mbps.");
  }
  if (!["auto", "h264", "hevc"].includes(codec)) throw new Error("Choose an MP4 codec.");
  if (!Number.isInteger(startDelayMs) || startDelayMs < 0 || startDelayMs > 60000) {
    throw new Error("Start delay must be between 0 and 60 seconds.");
  }
  if (!Number.isInteger(maxDurationSeconds) || maxDurationSeconds < 0 || maxDurationSeconds > 86400) {
    throw new Error("Auto-stop must be between 0 and 86,400 seconds. Use 0 for unlimited recording.");
  }
  if (typeof filenamePrefix !== "string") throw new Error("Enter a recording filename prefix.");
  const prefix = filenamePrefix.trim() || DEFAULT_OUTPUT_SETTINGS.filenamePrefix;
  if (prefix.length > 64 || /[\\/:*?"<>|\u0000-\u001f]/.test(prefix)) {
    throw new Error("Filename prefix must be at most 64 characters and cannot contain path separators or reserved filename characters.");
  }
  return { exportScale, cursorVisible, frameRate, bitrateMode, bitrateMbps, codec, startDelayMs, maxDurationSeconds, filenamePrefix: prefix };
}

export function recordingBitrate(width, height, settings = {}) {
  const options = { ...DEFAULT_OUTPUT_SETTINGS, ...settings };
  if (options.bitrateMode === "custom") return options.bitrateMbps * 1_000_000;
  const base = 30_000_000 * options.frameRate / 60;
  return Math.round(Math.max(base, Math.min(120_000_000, base * width * height / (1170 * 2532))));
}

export async function loadOutputSettings() {
  const saved = await chrome.storage.local.get([OUTPUT_SETTINGS_KEY, MOBILE_SETTINGS_KEY]);
  if (saved[OUTPUT_SETTINGS_KEY]) {
    return validateOutputSettings({ ...DEFAULT_OUTPUT_SETTINGS, ...saved[OUTPUT_SETTINGS_KEY] });
  }
  // Preserve the earlier mobile-only scale as the shared choice on upgrade.
  const legacyScale = saved[MOBILE_SETTINGS_KEY]?.exportScale;
  if (Number.isInteger(legacyScale) && legacyScale >= 1 && legacyScale <= 3) {
    return saveOutputSettings({ ...DEFAULT_OUTPUT_SETTINGS, exportScale: legacyScale });
  }
  return { ...DEFAULT_OUTPUT_SETTINGS };
}

export async function saveOutputSettings(settings) {
  const validated = validateOutputSettings(settings);
  await chrome.storage.local.set({ [OUTPUT_SETTINGS_KEY]: validated });
  return validated;
}

export function scaledOutputSize(width, height, exportScale) {
  if (![width, height].every(value => Number.isInteger(value) && value > 0)
    || !Number.isInteger(exportScale) || exportScale < 1 || exportScale > 3) {
    throw new Error("The recording viewport or output quality is unavailable.");
  }
  const outputWidth = width * exportScale;
  const outputHeight = height * exportScale;
  if (outputWidth > 8192 || outputHeight > 8192) {
    throw new Error(`The ${exportScale}× video would exceed 8,192 pixels per side. Choose a lower output quality or a smaller viewport.`);
  }
  // H.264/HEVC use even-sized 4:2:0 frames. Keep the requested content at its
  // exact scale and add at most one black edge pixel for MP4 compatibility.
  return { outputWidth: Math.ceil(outputWidth / 2) * 2, outputHeight: Math.ceil(outputHeight / 2) * 2,
    contentWidth: outputWidth, contentHeight: outputHeight };
}

export const COLLECT_POINTS_KEY = "collectScrollPoints";
export const SCROLL_POINTS_KEY = "scrollPoints";
export function scrollPointsPageKey(url) {
  const page = new URL(url);
  page.hash = "";
  return page.href;
}
