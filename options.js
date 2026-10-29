import { loadWindowWidth, saveWindowWidth, validateWindowWidth, loadScrollSettings, saveScrollSettings, loadMobileSettings, saveMobileSettings } from "./settings.js";

const form = document.querySelector("#width-form");
const fields = document.querySelector("#fields");
const widthInput = document.querySelector("#width");
const status = document.querySelector("#status");

function showStatus(text, error = false) {
  status.textContent = text;
  status.dataset.error = String(error);
}

async function initialize() {
  try {
    const saved = await loadWindowWidth();
    const width = saved ?? validateWindowWidth((await chrome.windows.getCurrent()).width);
    widthInput.value = width;
    showStatus(saved != null
      ? `Saved width: ${width} px. Height is automatic.`
      : "Save a width here, or your first recording will remember the current window width.");
    fields.disabled = false;
  } catch (error) {
    showStatus(`Could not load your window width. ${error.message}`, true);
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  fields.disabled = true;
  try {
    const width = await saveWindowWidth(widthInput.valueAsNumber);
    showStatus(`Saved width: ${width} px. Height is automatic.`);
  } catch (error) {
    showStatus(`Could not save. ${error.message}`, true);
  } finally {
    fields.disabled = false;
  }
});

void initialize();

const mobileForm = document.querySelector("#mobile-form");
const mobileEnabled = document.querySelector("#mobile-enabled");
const mobileFields = document.querySelector("#mobile-fields");
const mobileWidth = document.querySelector("#mobile-width");
const mobileHeight = document.querySelector("#mobile-height");
const mobileStatus = document.querySelector("#mobile-status");

function showMobileStatus(text, error = false) {
  mobileStatus.textContent = text;
  mobileStatus.dataset.error = String(error);
}

async function initializeMobile() {
  try {
    const settings = await loadMobileSettings();
    mobileEnabled.checked = settings.enabled;
    mobileWidth.value = settings.width;
    mobileHeight.value = settings.height;
    mobileEnabled.disabled = false;
    mobileFields.disabled = !settings.enabled;
    showMobileStatus(settings.enabled
      ? `Mobile mode: ${settings.width} × ${settings.height} px. Applies to the next recording.`
      : "Mobile mode is off. Recordings use your desktop window settings.");
  } catch (error) {
    showMobileStatus(`Could not load mobile mode. ${error.message}`, true);
  }
}

mobileEnabled.addEventListener("change", async () => {
  const enabled = mobileEnabled.checked;
  mobileEnabled.disabled = true;
  mobileFields.disabled = true;
  try {
    await saveMobileSettings({ ...await loadMobileSettings(), enabled });
    showMobileStatus(enabled
      ? "Mobile mode enabled for the next recording. Save any dimension changes below."
      : "Mobile mode disabled for the next recording.");
  } catch (error) {
    mobileEnabled.checked = !enabled;
    showMobileStatus(`Could not change mobile mode. ${error.message}`, true);
  } finally {
    mobileEnabled.disabled = false;
    mobileFields.disabled = !mobileEnabled.checked;
  }
});

mobileForm.addEventListener("submit", async event => {
  event.preventDefault();
  mobileEnabled.disabled = true;
  mobileFields.disabled = true;
  try {
    const settings = await saveMobileSettings({ enabled: mobileEnabled.checked, width: mobileWidth.valueAsNumber, height: mobileHeight.valueAsNumber });
    showMobileStatus(`Saved mobile viewport: ${settings.width} × ${settings.height} px. Applies to the next recording.`);
  } catch (error) {
    showMobileStatus(`Could not save. ${error.message}`, true);
  } finally {
    mobileEnabled.disabled = false;
    mobileFields.disabled = !mobileEnabled.checked;
  }
});
void initializeMobile();

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
    scrollFields.disabled = !settings.enabled;
    showScrollStatus(settings.enabled ? "Scroll shortcuts are enabled." : "Turn on the switch to use scroll shortcuts while recording.");
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
    scrollFields.disabled = !scrollEnabled.checked;
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
    scrollFields.disabled = !scrollEnabled.checked;
  }
});

async function loadShortcuts() {
  try {
    const commands = await chrome.commands.getAll();
    document.querySelector("#shortcut-down").textContent = commands.find(command => command.name === "scroll-down")?.shortcut || "Not assigned";
    document.querySelector("#shortcut-full").textContent = commands.find(command => command.name === "scroll-up")?.shortcut || "Not assigned";
  } catch {
    for (const id of ["#shortcut-down", "#shortcut-full"]) document.querySelector(id).textContent = "See Chrome shortcuts";
  }
}

document.querySelector("#change-shortcuts").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" }).catch(error => showScrollStatus(error.message, true));
});
window.addEventListener("focus", () => { void loadShortcuts(); });
void initializeScrolling();
void loadShortcuts();
