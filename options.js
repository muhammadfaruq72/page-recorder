import { DEFAULT_DESKTOP_SETTINGS, loadDesktopSettings, saveDesktopSettings, loadScrollSettings, saveScrollSettings, loadMobileSettings, saveMobileSettings, COLLECT_POINTS_KEY, SCROLL_POINTS_KEY } from "./settings.js";

function statusMessage(element, text, error = false) {
  element.textContent = text;
  element.dataset.error = String(error);
}
const desktopForm = document.querySelector("#desktop-form");
const desktopFields = document.querySelector("#desktop-fields");
const desktopWidth = document.querySelector("#desktop-width");
const desktopHeight = document.querySelector("#desktop-height");
const desktopStatus = document.querySelector("#desktop-status");
const mobileForm = document.querySelector("#mobile-form");
const mobileEnabled = document.querySelector("#mobile-enabled");
const mobileFields = document.querySelector("#mobile-fields");
const mobileWidth = document.querySelector("#mobile-width");
const mobileHeight = document.querySelector("#mobile-height");
const mobileStatus = document.querySelector("#mobile-status");
function desktopSummary(settings) {
  return `${settings.width} × ${settings.height} CSS px. Scales to the full available height with this aspect ratio. Applies on the next activation or switch to desktop.`;
}
async function initializeDimensions() {
  try {
    const desktop = await loadDesktopSettings();
    desktopWidth.value = desktop.width;
    desktopHeight.value = desktop.height;
    desktopFields.disabled = false;
    statusMessage(desktopStatus, desktopSummary(desktop));
    const mobile = await loadMobileSettings();
    mobileEnabled.checked = mobile.enabled;
    mobileWidth.value = mobile.width;
    mobileHeight.value = mobile.height;
    mobileEnabled.disabled = false;
    mobileFields.disabled = !mobile.enabled;
    statusMessage(mobileStatus, mobile.enabled ? "Mobile mode selected for the next activation." : "Desktop mode selected for the next activation.");
  } catch (error) { statusMessage(desktopStatus, error.message, true); }
}
desktopForm.addEventListener("submit", async event => {
  event.preventDefault();
  desktopFields.disabled = true;
  try {
    const saved = await saveDesktopSettings({ width: desktopWidth.valueAsNumber, height: desktopHeight.valueAsNumber });
    statusMessage(desktopStatus, `Saved. ${desktopSummary(saved)}`);
  } catch (error) { statusMessage(desktopStatus, error.message, true); }
  finally { desktopFields.disabled = false; }
});
document.querySelector("#desktop-default").addEventListener("click", async () => {
  desktopFields.disabled = true;
  try {
    const saved = await saveDesktopSettings(DEFAULT_DESKTOP_SETTINGS);
    desktopWidth.value = saved.width;
    desktopHeight.value = saved.height;
    statusMessage(desktopStatus, `Default restored. ${desktopSummary(saved)}`);
  } catch (error) { statusMessage(desktopStatus, error.message, true); }
  finally { desktopFields.disabled = false; }
});
mobileEnabled.addEventListener("change", async () => {
  mobileEnabled.disabled = true;
  try {
    const saved = await saveMobileSettings({ ...await loadMobileSettings(), enabled: mobileEnabled.checked });
    statusMessage(mobileStatus, `${saved.enabled ? "Mobile" : "Desktop"} mode selected for the next activation. Save any dimension changes below.`);
  } catch (error) {
    mobileEnabled.checked = !mobileEnabled.checked;
    statusMessage(mobileStatus, error.message, true);
  } finally { mobileEnabled.disabled = false; mobileFields.disabled = !mobileEnabled.checked; }
});
mobileForm.addEventListener("submit", async event => {
  event.preventDefault();
  mobileEnabled.disabled = true;
  mobileFields.disabled = true;
  try {
    const saved = await saveMobileSettings({ enabled: mobileEnabled.checked, width: mobileWidth.valueAsNumber, height: mobileHeight.valueAsNumber });
    statusMessage(mobileStatus, `Saved ${saved.width} × ${saved.height} CSS px. Applies on the next activation.`);
  } catch (error) { statusMessage(mobileStatus, error.message, true); }
  finally { mobileEnabled.disabled = false; mobileFields.disabled = !mobileEnabled.checked; }
});
void initializeDimensions();
async function refreshViewportStatus() {
  try {
    const element = document.querySelector("#viewport-status");
    statusMessage(element, await chrome.action.getTitle({}), await chrome.action.getBadgeText({}) === "!");
  } catch { /* The extension may be reloading. */ }
}
window.addEventListener("focus", () => { void refreshViewportStatus(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === "session" && changes.viewportSession) void refreshViewportStatus(); });
void refreshViewportStatus();

const scrollForm = document.querySelector("#scroll-form");
const scrollFields = document.querySelector("#scroll-fields");
const scrollEnabled = document.querySelector("#scroll-enabled");
const scrollEasing = document.querySelector("#scroll-easing");
const scrollDuration = document.querySelector("#scroll-duration");
const scrollPercent = document.querySelector("#scroll-percent");
const scrollStatus = document.querySelector("#scroll-status");

function showScrollStatus(text, error = false) {
  scrollStatus.textContent = text;
  scrollStatus.dataset.error = String(error);
}

async function initializeScrolling() {
  try {
    const settings = await loadScrollSettings();
    scrollEnabled.checked = settings.enabled;
    scrollEasing.value = settings.easing;
    scrollDuration.value = settings.durationMs / 1000;
    scrollPercent.value = settings.stepPercent;
    scrollEnabled.disabled = false;
    scrollFields.disabled = false;
    showScrollStatus(settings.enabled ? "Scroll shortcuts are enabled." : "Turn on the switch to use scroll shortcuts while viewport mode is on.");
  } catch (error) {
    showScrollStatus(`Could not load scrolling settings. ${error.message}`, true);
  }
}

scrollEnabled.addEventListener("change", async () => {
  const enabled = scrollEnabled.checked;
  scrollEnabled.disabled = true;
  scrollFields.disabled = true;
  try {
    const saved = await loadScrollSettings();
    await saveScrollSettings({ ...saved, enabled });
    showScrollStatus(enabled ? "Scroll shortcuts enabled. Save below to apply any other changes." : "Scroll shortcuts disabled. Any active scroll has stopped.");
  } catch (error) {
    scrollEnabled.checked = !enabled;
    showScrollStatus(`Could not change the scrolling switch. ${error.message}`, true);
  } finally {
    scrollEnabled.disabled = false;
    scrollFields.disabled = false;
  }
});

scrollForm.addEventListener("submit", async event => {
  event.preventDefault();
  scrollFields.disabled = true;
  scrollEnabled.disabled = true;
  try {
    const saved = await saveScrollSettings({
      enabled: scrollEnabled.checked,
      easing: scrollEasing.value,
      durationMs: Math.round(scrollDuration.valueAsNumber * 1000),
      stepPercent: scrollPercent.valueAsNumber,
    });
    showScrollStatus(`Saved. Percentage step: ${saved.stepPercent}%. Full viewport step: 100%. Both take ${saved.durationMs / 1000} seconds.`);
  } catch (error) {
    showScrollStatus(`Could not save scrolling settings. ${error.message}`, true);
  } finally {
    scrollEnabled.disabled = false;
    scrollFields.disabled = false;
  }
});

async function loadShortcuts() {
  try {
    const commands = await chrome.commands.getAll();
    document.querySelector("#shortcut-down").textContent = commands.find(command => command.name === "scroll-down")?.shortcut || "Not assigned";
    document.querySelector("#shortcut-point").textContent = commands.find(command => command.name === "scroll-next-point")?.shortcut || "Not assigned";
    document.querySelector("#shortcut-full").textContent = commands.find(command => command.name === "scroll-up")?.shortcut || "Not assigned";
  } catch {
    for (const id of ["#shortcut-down", "#shortcut-full", "#shortcut-point"]) document.querySelector(id).textContent = "See Chrome shortcuts";
  }
}

document.querySelector("#change-shortcuts").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" }).catch(error => showScrollStatus(error.message, true));
});
window.addEventListener("focus", () => { void loadShortcuts(); });
void initializeScrolling();
void loadShortcuts();

const collectPoints = document.querySelector("#points-collect");
const clearPoints = document.querySelector("#points-clear");
const pointsList = document.querySelector("#points-list");
const pointsStatus = document.querySelector("#points-status");
function pointStatus(text, error = false) {
  pointsStatus.textContent = text;
  pointsStatus.dataset.error = String(error);
}
async function renderPoints() {
  const saved = await chrome.storage.local.get([COLLECT_POINTS_KEY, SCROLL_POINTS_KEY]);
  collectPoints.checked = !!saved[COLLECT_POINTS_KEY];
  pointsList.replaceChildren();
  const pages = Object.entries(saved[SCROLL_POINTS_KEY] || {}).filter(([, points]) => points.length);
  for (const [url, points] of pages) {
    const title = document.createElement("p");
    title.textContent = url;
    const list = document.createElement("ol");
    for (const top of points) {
      const item = document.createElement("li");
      item.textContent = `${top.toLocaleString()} px from top`;
      list.append(item);
    }
    pointsList.append(title, list);
  }
  if (!pages.length) pointsList.textContent = "No scroll points saved yet.";
  clearPoints.disabled = !pages.length;
}
collectPoints.addEventListener("change", async () => {
  const enabled = collectPoints.checked;
  collectPoints.disabled = true;
  try {
    // Request directly inside this user gesture, before any asynchronous work.
    if (enabled && !await chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] })) {
      throw new Error("Website access is required to show the collection button. Collection remains off.");
    }
    await chrome.storage.local.set({ [COLLECT_POINTS_KEY]: enabled });
    pointStatus(enabled ? "Collection is on. Open your webpage and click Save scroll point at each position." : "Collection is off. Saved points are ready to use.");
  } catch (error) {
    pointStatus(error.message, true);
  } finally {
    await renderPoints();
    collectPoints.disabled = false;
  }
});
clearPoints.addEventListener("click", async () => {
  clearPoints.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ target: "background", type: "CLEAR_SCROLL_POINTS" });
    if (!result?.ok) throw new Error(result?.error || "Could not clear points.");
    await renderPoints();
    pointStatus("All saved scroll points cleared.");
  } catch (error) { pointStatus(error.message, true); clearPoints.disabled = false; }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.mobileViewportSettings?.newValue) {
    mobileEnabled.checked = changes.mobileViewportSettings.newValue.enabled;
    mobileFields.disabled = !mobileEnabled.checked;
  }
  if (area === "local" && (changes[COLLECT_POINTS_KEY] || changes[SCROLL_POINTS_KEY])) {
    void renderPoints().catch(error => pointStatus(error.message, true));
  }
});
void renderPoints().then(() => {
  collectPoints.disabled = false;
  pointStatus("Points play in collection order with the next-point shortcut while viewport mode is on.");
}).catch(error => pointStatus(error.message, true));
