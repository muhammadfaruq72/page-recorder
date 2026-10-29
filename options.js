import { loadWindowWidth, saveWindowWidth, validateWindowWidth, loadScrollSettings, saveScrollSettings, loadMobileSettings, saveMobileSettings, loadOutputSettings, saveOutputSettings, DEFAULT_OUTPUT_SETTINGS, scaledOutputSize, recordingBitrate } from "./settings.js";

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
const outputFields = document.querySelector("#output-fields");
const outputScale = document.querySelector("#output-scale");
const cursorVisible = document.querySelector("#cursor-visible");
const outputStatus = document.querySelector("#output-status");
const outputFps = document.querySelector("#output-fps");
const bitrateMode = document.querySelector("#output-bitrate-mode");
const bitrateMbps = document.querySelector("#output-bitrate-mbps");
const outputCodec = document.querySelector("#output-codec");
const startDelay = document.querySelector("#output-start-delay");
const maxDuration = document.querySelector("#output-max-duration");
const filenamePrefix = document.querySelector("#output-filename-prefix");
const storageEstimate = document.querySelector("#output-storage-estimate");
let outputSettings = { ...DEFAULT_OUTPUT_SETTINGS };
const mobileOutputResolution = document.querySelector("#mobile-output-resolution");

function updateStorageEstimate() {
  const storage = bps => `${Math.round(bps * 60 / 8_000_000)} MB/min`;
  if (outputSettings.bitrateMode === "custom") {
    storageEstimate.textContent = `Target bitrate: ${outputSettings.bitrateMbps} Mbps · approximately ${storage(outputSettings.bitrateMbps * 1_000_000)}.`;
    return;
  }
  if (mobileEnabled.checked) {
    try {
      const size = scaledOutputSize(mobileWidth.valueAsNumber, mobileHeight.valueAsNumber, outputSettings.exportScale);
      const bps = recordingBitrate(size.outputWidth, size.outputHeight, outputSettings);
      storageEstimate.textContent = `Current mobile target: ${(bps / 1_000_000).toFixed(1)} Mbps · approximately ${storage(bps)}. Actual file size varies with the page.`;
      return;
    } catch { /* Wait for valid mobile dimensions. */ }
  }
  const base = 30_000_000 * outputSettings.frameRate / 60;
  storageEstimate.textContent = `Automatic bitrate: ${(base / 1_000_000).toFixed(1)}–120 Mbps (${storage(base)}–900 MB/min), depending on the final viewport. Actual file size varies.`;
}

function updateMobileOutput() {
  const width = mobileWidth.valueAsNumber;
  const height = mobileHeight.valueAsNumber;
  const scale = outputSettings.exportScale;
  try {
    const size = scaledOutputSize(width, height, scale);
    mobileOutputResolution.textContent = `${size.outputWidth} × ${size.outputHeight} px · MP4`;
  } catch (error) {
    mobileOutputResolution.textContent = Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
      ? error.message : "Enter viewport dimensions";
  }
  updateStorageEstimate();
}

for (const input of [mobileWidth, mobileHeight]) input.addEventListener("input", updateMobileOutput);

function showOutputStatus(text, error = false) {
  outputStatus.textContent = text;
  outputStatus.dataset.error = String(error);
}

function renderOutputSettings() {
  outputScale.value = String(outputSettings.exportScale);
  cursorVisible.checked = outputSettings.cursorVisible;
  outputFps.value = String(outputSettings.frameRate);
  bitrateMode.value = outputSettings.bitrateMode;
  bitrateMbps.value = outputSettings.bitrateMbps;
  bitrateMbps.disabled = outputSettings.bitrateMode !== "custom";
  outputCodec.value = outputSettings.codec;
  startDelay.value = outputSettings.startDelayMs / 1000;
  maxDuration.value = outputSettings.maxDurationSeconds;
  filenamePrefix.value = outputSettings.filenamePrefix;
  document.querySelector("#desktop-output-scale").textContent = `${outputSettings.exportScale}× resolution`;
  updateMobileOutput();
}

function outputSummary() {
  const codec = { auto: "Auto codec", h264: "H.264", hevc: "HEVC" }[outputSettings.codec];
  const bitrate = outputSettings.bitrateMode === "custom" ? `${outputSettings.bitrateMbps} Mbps` : "Auto bitrate";
  return `${outputSettings.exportScale}× · ${outputSettings.frameRate} FPS · ${bitrate} · ${codec} · Cursor ${outputSettings.cursorVisible ? "visible" : "hidden"}`;
}

async function initializeOutput() {
  try {
    outputSettings = await loadOutputSettings();
    renderOutputSettings();
    outputFields.disabled = false;
    showOutputStatus(`${outputSummary()}. Applies to both modes on your next recording.`);
  } catch (error) {
    showOutputStatus(`Could not load output settings. ${error.message}`, true);
  }
}
const outputReady = initializeOutput();

async function saveSharedOutput() {
  outputFields.disabled = true;
  try {
    outputSettings = await saveOutputSettings({
      exportScale: Number(outputScale.value), cursorVisible: cursorVisible.checked,
      frameRate: Number(outputFps.value), bitrateMode: bitrateMode.value,
      bitrateMbps: bitrateMbps.valueAsNumber, codec: outputCodec.value,
      startDelayMs: Math.round(startDelay.valueAsNumber * 1000),
      maxDurationSeconds: maxDuration.valueAsNumber, filenamePrefix: filenamePrefix.value,
    });
    renderOutputSettings();
    showOutputStatus(`Saved. ${outputSummary()}. Applies to both modes on your next recording.`);
  } catch (error) {
    renderOutputSettings();
    showOutputStatus(`Could not save output settings. ${error.message}`, true);
  } finally {
    outputFields.disabled = false;
  }
}
for (const input of [outputScale, cursorVisible, outputFps, bitrateMode, bitrateMbps, outputCodec, startDelay, maxDuration, filenamePrefix]) {
  input.addEventListener("change", saveSharedOutput);
}

function showMobileStatus(text, error = false) {
  mobileStatus.textContent = text;
  mobileStatus.dataset.error = String(error);
}

async function initializeMobile() {
  try {
    await outputReady;
    const settings = await loadMobileSettings();
    mobileEnabled.checked = settings.enabled;
    mobileWidth.value = settings.width;
    mobileHeight.value = settings.height;
    updateMobileOutput();
    mobileEnabled.disabled = false;
    mobileFields.disabled = !settings.enabled;
    showMobileStatus(settings.enabled
      ? `Saved mobile layout: ${settings.width} × ${settings.height} px. Applies to the next recording.`
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
    updateMobileOutput();
  }
});

mobileForm.addEventListener("submit", async event => {
  event.preventDefault();
  mobileEnabled.disabled = true;
  mobileFields.disabled = true;
  try {
    const settings = await saveMobileSettings({ enabled: mobileEnabled.checked, width: mobileWidth.valueAsNumber, height: mobileHeight.valueAsNumber });
    updateMobileOutput();
    showMobileStatus(`Saved mobile layout: ${settings.width} × ${settings.height} px. Applies to the next recording.`);
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
