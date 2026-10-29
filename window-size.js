import { loadWindowWidth, saveWindowWidth, validateWindowWidth } from "./settings.js";

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function selectRecordingDisplay(window, displays) {
  const active = displays.filter(display => display.isEnabled !== false && display.activeState !== "inactive"
    && display.workArea?.width > 0 && display.workArea?.height > 0);
  let selected;
  let largestOverlap = -1;
  let shortestDistance = Infinity;
  for (const display of active) {
    const bounds = display.bounds;
    const overlapWidth = Math.max(0, Math.min(window.left + window.width, bounds.left + bounds.width) - Math.max(window.left, bounds.left));
    const overlapHeight = Math.max(0, Math.min(window.top + window.height, bounds.top + bounds.height) - Math.max(window.top, bounds.top));
    const overlap = overlapWidth * overlapHeight;
    const centerX = window.left + window.width / 2;
    const centerY = window.top + window.height / 2;
    const dx = Math.max(bounds.left - centerX, 0, centerX - bounds.left - bounds.width);
    const dy = Math.max(bounds.top - centerY, 0, centerY - bounds.top - bounds.height);
    const distance = dx * dx + dy * dy;
    if (overlap > largestOverlap || (overlap === largestOverlap && distance < shortestDistance)) {
      selected = display;
      largestOverlap = overlap;
      shortestDistance = distance;
    }
  }
  if (!selected) throw new Error("Could not determine the available display height. Try again.");
  return selected;
}

export function recordingWindowBounds(window, width, display) {
  const area = display.workArea;
  if (width > area.width) {
    throw new Error(`The saved width (${width} px) exceeds this display's available width (${area.width} px). Choose a smaller width in Options.`);
  }
  return {
    width,
    height: area.height,
    top: area.top,
    left: Math.max(area.left, Math.min(window.left, area.left + area.width - width)),
  };
}

export async function prepareRecordingWindow(tab, { pause = delay, attempts = 30 } = {}) {
  if (!Number.isInteger(tab.windowId) || tab.windowId < 0) {
    throw new Error("Could not find the tab's Chrome window. Try again.");
  }
  const [savedWidth, initialWindow, displays] = await Promise.all([
    loadWindowWidth(),
    chrome.windows.get(tab.windowId),
    chrome.system.display.getInfo(),
  ]);
  let window = initialWindow;
  // Select the current display before restoring a fullscreen/maximized window.
  const display = selectRecordingDisplay(window, displays);

  // Chrome requires leaving fullscreen/maximized state before setting bounds.
  if (window.state !== "normal") {
    await chrome.windows.update(tab.windowId, { state: "normal" });
    for (let attempt = 0; attempt < attempts; attempt++) {
      window = await chrome.windows.get(tab.windowId);
      if (window.state === "normal") break;
      await pause(100);
    }
    if (window.state !== "normal") {
      throw new Error("Chrome could not leave fullscreen or maximized mode. Restore the window and try again.");
    }
  }

  // Width is remembered once. Height is recalculated from the current display
  // every time, excluding the taskbar, Dock, and other reserved desktop areas.
  const width = savedWidth ?? validateWindowWidth(Math.min(window.width, display.workArea.width));
  const bounds = recordingWindowBounds(window, width, display);
  await chrome.windows.update(tab.windowId, bounds);

  let previousTab;
  for (let attempt = 0; attempt < attempts; attempt++) {
    window = await chrome.windows.get(tab.windowId);
    const refreshedTab = await chrome.tabs.get(tab.id);
    if (refreshedTab.windowId !== tab.windowId) {
      throw new Error("The tab moved to another window. Click the recorder again to try there.");
    }
    const correctBounds = window.state === "normal"
      && ["width", "height", "top", "left"].every(key => window[key] === bounds[key]);
    const stableViewport = refreshedTab.width > 0 && refreshedTab.height > 0
      && refreshedTab.width === previousTab?.width && refreshedTab.height === previousTab?.height;
    if (correctBounds && stableViewport) {
      if (savedWidth == null) await saveWindowWidth(width);
      return refreshedTab;
    }
    previousTab = refreshedTab;
    await pause(100);
  }

  throw new Error(`Chrome could not resize the window to ${bounds.width} × ${bounds.height} px (current size: ${window.width} × ${window.height}). Check your window position or choose a smaller width in Options.`);
}
