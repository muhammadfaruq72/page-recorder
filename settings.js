export const DESKTOP_SETTINGS_KEY = "desktopViewportSettings";
export const MOBILE_SETTINGS_KEY = "mobileViewportSettings";
export const SCROLL_SETTINGS_KEY = "smoothScrollSettings";
export const COLLECT_POINTS_KEY = "collectScrollPoints";
export const SCROLL_POINTS_KEY = "scrollPoints";
export const DEFAULT_DESKTOP_SETTINGS = Object.freeze({ width: 1080, height: 1215 });
export const DEFAULT_MOBILE_SETTINGS = Object.freeze({ enabled: false, width: 390, height: 844 });
export const DEFAULT_SCROLL_SETTINGS = Object.freeze({ enabled: false, easing: "smootherstep", durationMs: 1500, stepPercent: 30 });
export const SCROLL_EASINGS = ["smootherstep", "ease-in-out-sine", "ease-out-cubic", "linear"];

function dimension(value, name, max) {
  if (!Number.isInteger(value) || value < 100 || value > max) {
    throw new Error(`${name} must be a whole number between 100 and ${max.toLocaleString("en-US")} pixels.`);
  }
  return value;
}
export function validateDesktopSettings(settings) {
  return { width: dimension(settings?.width, "Desktop width", 16384), height: dimension(settings?.height, "Desktop height", 16384) };
}
export async function loadDesktopSettings() {
  const saved = await chrome.storage.local.get([DESKTOP_SETTINGS_KEY, "recordingWindowWidth", "recordingWindowSize"]);
  const current = saved[DESKTOP_SETTINGS_KEY];
  if (current?.height > 0) return validateDesktopSettings(current);
  // Older versions stored a width and automatic height (0). Keep that width
  // and supply a reference height derived from the new desktop aspect ratio.
  const widthOnly = current?.width ?? saved.recordingWindowWidth ?? saved.recordingWindowSize?.width;
  if (widthOnly != null) return saveDesktopSettings({
    width: widthOnly,
    height: Math.min(16384, Math.max(100, Math.round(widthOnly * DEFAULT_DESKTOP_SETTINGS.height / DEFAULT_DESKTOP_SETTINGS.width))),
  });
  return { ...DEFAULT_DESKTOP_SETTINGS };
}
export async function saveDesktopSettings(settings) {
  const validated = validateDesktopSettings(settings);
  await chrome.storage.local.set({ [DESKTOP_SETTINGS_KEY]: validated });
  await chrome.storage.local.remove(["recordingWindowWidth", "recordingWindowSize"]);
  return validated;
}
export function validateMobileSettings(settings) {
  if (typeof settings?.enabled !== "boolean") throw new Error("Choose whether mobile mode is enabled.");
  return { enabled: settings.enabled, width: dimension(settings.width, "Mobile width", 4096), height: dimension(settings.height, "Mobile height", 4096) };
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
export function validateScrollSettings(settings) {
  const { enabled, easing, durationMs, stepPercent } = settings || {};
  if (typeof enabled !== "boolean") throw new Error("Choose whether scroll shortcuts are enabled.");
  if (!SCROLL_EASINGS.includes(easing)) throw new Error("Choose a supported scrolling transition.");
  if (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > 60000) throw new Error("Animation duration must be between 0.1 and 60 seconds.");
  if (!Number.isFinite(stepPercent) || stepPercent < 0.1 || stepPercent > 100) throw new Error("Scroll distance must be between 0.1% and 100% of the visible page height.");
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
export function scrollPointsPageKey(url) {
  const page = new URL(url);
  page.hash = "";
  return page.href;
}
