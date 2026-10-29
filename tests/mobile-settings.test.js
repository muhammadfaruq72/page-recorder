import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MOBILE_SETTINGS, MOBILE_SETTINGS_KEY, loadMobileSettings, saveMobileSettings } from "../settings.js";

test("mobile mode defaults to off with a 390 by 844 CSS-pixel viewport", async () => {
  globalThis.chrome = { storage: { local: { get: async () => ({}) } } };
  assert.deepEqual(await loadMobileSettings(), DEFAULT_MOBILE_SETTINGS);
});

test("mobile dimensions persist, including when the mode is turned off", async () => {
  const saved = {};
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(saved),
    set: async values => Object.assign(saved, structuredClone(values)),
  } } };
  await saveMobileSettings({ enabled: true, width: 412, height: 915 });
  assert.deepEqual(await loadMobileSettings(), { enabled: true, width: 412, height: 915 });
  await saveMobileSettings({ ...await loadMobileSettings(), enabled: false });
  assert.deepEqual(saved[MOBILE_SETTINGS_KEY], { enabled: false, width: 412, height: 915 });
  for (const invalid of [{ width: 0 }, { height: 4097 }, { width: 390.5 }, { height: NaN }, { enabled: "true" }]) {
    await assert.rejects(saveMobileSettings({ ...DEFAULT_MOBILE_SETTINGS, ...invalid }));
  }
  assert.equal(saved[MOBILE_SETTINGS_KEY].width, 412);
});
