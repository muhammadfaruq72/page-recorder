export const WINDOW_WIDTH_KEY = "recordingWindowWidth";
export const LEGACY_WINDOW_SIZE_KEY = "recordingWindowSize";
export const SCROLL_SETTINGS_KEY = "smoothScrollSettings";
export const MOBILE_SETTINGS_KEY = "mobileViewportSettings";
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
