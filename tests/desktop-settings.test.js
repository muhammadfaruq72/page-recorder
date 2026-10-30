import test from "node:test";
import assert from "node:assert/strict";
import { mockChrome } from "./helpers.mjs";
import { loadDesktopSettings, saveDesktopSettings, loadScrollSettings, DEFAULT_SCROLL_SETTINGS } from "../settings.js";

test("desktop defaults to a 1920 by 1080 reference resolution", async () => {
  mockChrome(); assert.deepEqual(await loadDesktopSettings(), { width: 1920, height: 1080 });
});
test("existing saved window width migrates to viewport width while obsolete window height is discarded", async () => {
  for (const preferences of [{ recordingWindowWidth: 1300 }, { recordingWindowSize: { width: 1100, height: 700 } }, { desktopViewportSettings: { width: 1280, height: 0 } }]) {
    const h = mockChrome(preferences);
    const expected = preferences.recordingWindowWidth || preferences.recordingWindowSize?.width || preferences.desktopViewportSettings.width;
    const height = Math.round(expected * 9 / 16);
    assert.deepEqual(await loadDesktopSettings(), { width: expected, height });
    assert.deepEqual(h.preferences, { desktopViewportSettings: { width: expected, height } });
  }
});
test("fixed viewport height persists and invalid dimensions cannot replace saved settings", async () => {
  const h = mockChrome();
  await saveDesktopSettings({ width: 1440, height: 900 });
  assert.deepEqual(await loadDesktopSettings(), { width: 1440, height: 900 });
  for (const invalid of [{ width: 0 }, { height: 0 }, { height: -1 }, { height: 50 }, { width: 1.5 }, { width: 16385 }, { height: NaN }]) {
    await assert.rejects(saveDesktopSettings({ width: 1440, height: 900, ...invalid }));
  }
  assert.deepEqual(h.preferences.desktopViewportSettings, { width: 1440, height: 900 });
});
test("scroll defaults and existing choices are retained", async () => {
  mockChrome(); assert.deepEqual(await loadScrollSettings(), DEFAULT_SCROLL_SETTINGS);
  mockChrome({ smoothScrollSettings: { enabled: true, easing: "linear", durationMs: 2500, stepPercent: 40 } });
  assert.deepEqual(await loadScrollSettings(), { enabled: true, easing: "linear", durationMs: 2500, stepPercent: 40 });
});
