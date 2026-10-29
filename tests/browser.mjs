import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { scrollPage } from "../smooth-scroll.js";
import { recordingShortcuts } from "../recording-shortcuts.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "test-results");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "page-recorder-test-"));
const server = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html><html><head><title>Recorder test</title><style>
    html{scroll-behavior:smooth}body{margin:0;background:#132239;color:#fff;font:28px system-ui;padding:60px;${request.url === "/scroll" ? "min-height:3400px" : ""}}
    a{color:#83e4b4}canvas{display:block;margin-top:32px}
    </style></head><body><h1>${request.url === "/next" ? "Navigation survived" : "Page Recorder test"}</h1>
    <a href="/next">Navigate while recording</a><canvas width="800" height="280"></canvas>
    <script>const c=document.querySelector('canvas'),x=c.getContext('2d');function draw(t){
      x.fillStyle='#132239';x.fillRect(0,0,800,280);x.fillStyle='#f84c56';x.beginPath();
      x.arc(90+(Math.sin(t/500)+1)*290,120,50,0,Math.PI*2);x.fill();x.fillStyle='#fff';
      x.font='24px system-ui';x.fillText('Frame time: '+Math.round(t)+' ms',20,250);requestAnimationFrame(draw)}
      requestAnimationFrame(draw);</script></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;

try {
  context = await chromium.launchPersistentContext(profile, {
    headless: process.env.HEADED !== "1",
    channel: "chromium",
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
    viewport: null,
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
      "--enable-unsafe-extension-debugging",
      "--window-size=1100,900",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
  if (process.env.DEBUG_RECORDER === "1") {
    context.on("console", message => console.log(`BROWSER ${message.type()}: ${message.text()}`));
    context.on("weberror", error => console.log("BROWSER ERROR:", error.error()));
  }
  let worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15_000 });
  await worker.evaluate(() => {
    globalThis.testToolbarClicks = [];
    globalThis.testCommandEvents = [];
    chrome.action.onClicked.addListener(tab => globalThis.testToolbarClicks.push(tab));
    chrome.commands.onCommand.addListener((command, tab) => globalThis.testCommandEvents.push({ command, tabId: tab?.id }));
  });
  const extensionId = new URL(worker.url()).hostname;
  const page = await context.newPage();
  const cdp = await context.browser().newBrowserCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: output });

  async function clickToolbar(targetPage) {
    await targetPage.bringToFront();
    const targetSession = await context.newCDPSession(targetPage);
    const { targetInfo } = await targetSession.send("Target.getTargetInfo");
    const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
    const tabTarget = targetInfos.find(target => target.type === "tab" && target.url === targetInfo.url);
    if (!tabTarget) throw new Error(`No tab target for ${targetInfo.url}: ${JSON.stringify(targetInfos)}`);
    await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: tabTarget.targetId });
    await targetSession.detach();
  }

  async function waitBadge(expected, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    let badge;
    while (Date.now() < deadline) {
      worker = context.serviceWorkers().find(candidate => candidate.url().includes(extensionId)) || worker;
      badge = await worker.evaluate(() => chrome.action.getBadgeText({}));
      if (badge === expected) return;
      if (badge === "!" && expected !== "!") {
        throw new Error(await worker.evaluate(async () => `${await chrome.action.getTitle({})} ${JSON.stringify(await chrome.runtime.sendMessage({ target: "recorder", type: "STATUS" }))}`));
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const diagnostic = await worker.evaluate(async () => ({
      title: await chrome.action.getTitle({}),
      clicks: globalThis.testToolbarClicks,
      contexts: await chrome.runtime.getContexts({}),
    }));
    throw new Error(`Expected badge '${expected}', received '${badge}': ${JSON.stringify(diagnostic)}`);
  }

  await worker.evaluate(() => chrome.storage.local.set({ recordingWindowSize: { width: 620, height: 300 } }));
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.waitForFunction(() => !document.querySelector("#fields").disabled);
  assert.equal(await options.locator("#width").inputValue(), "620");
  assert.equal(await options.locator("#width-form input").count(), 1);
  assert.equal(await options.locator("#height").count(), 0);
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(null)), { recordingWindowWidth: 620 });
  console.log("PASS: the previous saved width is migrated and the height setting is removed");
  await options.locator("#width").fill("640");
  await options.getByRole("button", { name: "Save width" }).click();
  await options.getByRole("status").filter({ hasText: "Saved width: 640 px. Height is automatic." }).waitFor();
  await options.reload();
  await options.waitForFunction(() => !document.querySelector("#fields").disabled);
  assert.equal(await options.locator("#width").inputValue(), "640");
  await options.waitForFunction(() => !document.querySelector("#scroll-enabled").disabled);
  assert.equal(await options.locator("#scroll-enabled").isChecked(), false);
  assert.equal(await options.locator("#scroll-duration").inputValue(), "1.5");
  assert.equal(await options.locator("#scroll-percent").inputValue(), "30");
  assert.equal(await options.locator("#scroll-easing").inputValue(), "smootherstep");
  await options.locator("#scroll-enabled").check();
  await options.locator("#scroll-duration").fill("0.4");
  await options.getByRole("button", { name: "Save scrolling settings" }).click();
  await options.locator("#scroll-status").filter({ hasText: "Saved. Percentage step: 30%. Full viewport step: 100%. Both take 0.4 seconds." }).waitFor();
  await options.getByText("Down · saved percentage", { exact: true }).waitFor();
  await options.getByText("Down · full viewport (100%)", { exact: true }).waitFor();
  await options.reload();
  await options.waitForFunction(() => !document.querySelector("#scroll-enabled").disabled);
  assert.equal(await options.locator("#scroll-enabled").isChecked(), true);
  assert.equal(await options.locator("#scroll-duration").inputValue(), "0.4");
  assert.equal(await options.locator("#scroll-percent").inputValue(), "30");
  const assigned = await worker.evaluate(() => chrome.commands.getAll());
  assert.ok(assigned.find(item => item.name === "scroll-down")?.shortcut);
  assert.ok(assigned.find(item => item.name === "scroll-up")?.shortcut);
  await options.screenshot({ path: path.join(output, "options.png"), fullPage: true });
  await options.close();
  console.log("PASS: Options saves only window width across reloads");
  console.log("PASS: smooth-scroll defaults, master switch, animation settings, and assigned shortcuts persist");

  async function assertSavedBounds() {
    const { window, displays } = await worker.evaluate(async () => ({
      window: await chrome.windows.getLastFocused(), displays: await chrome.system.display.getInfo(),
    }));
    assert.equal(window.width, 640);
    const display = displays.find(item => window.left >= item.workArea.left && window.left + window.width <= item.workArea.left + item.workArea.width
      && window.top === item.workArea.top && window.height === item.workArea.height);
    assert.ok(display, "The recording window must fill the entire usable height of its display");
    assert.equal(window.state, "normal");
    return window.height;
  }

  await page.goto(origin);
  await clickToolbar(page);
  await waitBadge("REC");
  const automaticHeight = await assertSavedBounds();
  const sourceViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  console.log("PASS: recording uses the saved width and maximum usable display height");
  console.log("PASS: toolbar action starts real tab video capture");
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).cursor), "none");
  console.log("PASS: the cursor is hidden during desktop recording");

  // Exceed one timeslice so both streamed chunks and the final chunk are tested.
  await page.waitForTimeout(2_500);
  await page.getByRole("link", { name: "Navigate while recording" }).click();
  await page.getByRole("heading", { name: "Navigation survived" }).waitFor();
  await page.waitForTimeout(3_000);
  await waitBadge("REC");
  console.log("PASS: capture continues across page navigation");
  await page.waitForFunction(() => getComputedStyle(document.body).cursor === "none");

  const secondTab = await context.newPage();
  await secondTab.goto(`${origin}/other`);
  await clickToolbar(secondTab);
  await waitBadge("");
  console.log("PASS: the same toolbar button stops capture from another tab");
  await page.waitForFunction(() => getComputedStyle(document.body).cursor !== "none");
  console.log("PASS: cursor hiding follows navigation and is removed when recording stops");

  const downloads = await worker.evaluate(() => chrome.downloads.search({ orderBy: ["-startTime"] }));
  const videoDownload = downloads.find(item => item.byExtensionId === extensionId);
  assert.ok(videoDownload, "A video download should exist");
  assert.equal(videoDownload.state, "complete");
  const bytes = await readFile(videoDownload.filename);
  assert.ok(bytes.length > 1_000, "Video should contain encoded frames");
  const videoPath = path.join(output, `smoke-recording.${path.extname(videoDownload.filename).slice(1)}`);
  await writeFile(videoPath, bytes);

  await secondTab.setContent('<input type="file"><video controls muted></video>');
  await secondTab.locator('input[type="file"]').setInputFiles(videoPath);
  const video = await secondTab.evaluate(async () => {
    const element = document.querySelector("video");
    element.src = URL.createObjectURL(document.querySelector("input").files[0]);
    await new Promise((resolve, reject) => {
      element.onloadeddata = resolve;
      element.onerror = () => reject(new Error(element.error?.message || "Video failed to decode"));
    });
    await element.play();
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 5_000;
      const check = () => {
        if (element.currentTime > 0.1) return resolve();
        if (performance.now() >= deadline) return reject(new Error("Video playback did not advance"));
        setTimeout(check, 50);
      };
      check();
    });
    element.pause();
    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(element, 0, 0);
    return { width: element.videoWidth, height: element.videoHeight, duration: element.duration, currentTime: element.currentTime, pixel: [...ctx.getImageData(5, 5, 1, 1).data] };
  });
  assert.ok(video.width > 0 && video.height > 0);
  assert.ok(Math.abs(video.width / video.height - sourceViewport.width / sourceViewport.height) < 0.01, `Capture should preserve the webpage's aspect ratio: ${JSON.stringify({ video, sourceViewport })}`);
  assert.ok(video.currentTime > 0, "Video should play");
  assert.ok(video.pixel.slice(0, 3).some(value => value > 8), "The captured page should not be a black frame");
  console.log("PASS: downloaded video decodes and plays", { ...video, bytes: bytes.length });

  // CDP key events bypass Chrome's native shortcut dispatcher. Exercise actual
  // script injection here; test:native verifies the real shortcut keypresses.
  async function animateStep(direction) {
    const data = await worker.evaluate(async () => {
      const { status } = await chrome.runtime.sendMessage({ target: "recorder", type: "STATUS" });
      const { smoothScrollSettings } = await chrome.storage.local.get("smoothScrollSettings");
      return { tabId: status.tabId, sessionId: status.sessionId, settings: smoothScrollSettings };
    });
    await worker.evaluate(`chrome.scripting.executeScript({target:{tabId:${data.tabId}},func:${scrollPage.toString()},args:${JSON.stringify([{ action: "step", direction, sessionId: data.sessionId, settings: data.settings }])}})`);
  }
  await page.bringToFront();
  await page.goto(`${origin}/scroll`);
  await worker.evaluate(async () => {
    const window = await chrome.windows.getLastFocused();
    await chrome.windows.update(window.id, { width: 700, height: 500, left: 0, top: 0 });
  });
  await clickToolbar(page);
  await waitBadge("REC");
  await assertSavedBounds();
  console.log("PASS: a later recording reapplies the saved width and full display height after a manual resize");

  await page.evaluate(() => {
    globalThis.scrollSamples = [];
    addEventListener("scroll", () => globalThis.scrollSamples.push(scrollY));
  });
  const distance = await page.evaluate(() => innerHeight * .3);
  // Arc's fallback receives trusted page key events even when the browser's
  // native extension-command dispatcher does not emit onCommand.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+Digit9" : "Control+Shift+Digit9");
  await page.waitForFunction(expected => Math.abs(scrollY - expected) <= 1.5, distance, { timeout: 4000 });
  await page.waitForTimeout(100);
  const firstStep = await page.evaluate(() => ({ top: scrollY, samples: globalThis.scrollSamples }));
  console.log("PASS: the page keyboard fallback triggers a real scroll while recording");
  assert.ok(firstStep.samples.filter(value => value > 0 && value < firstStep.top).length >= 3, "The scroll should include intermediate animated frames");
  await worker.evaluate(`(async()=>{
    const {status}=await chrome.runtime.sendMessage({target:"recorder",type:"STATUS"});
    await chrome.scripting.executeScript({target:{tabId:status.tabId},func:${recordingShortcuts.toString()},args:[{
      action:"install",sessionId:status.sessionId,commands:(await chrome.commands.getAll()).map(command=>command.name==="scroll-down"?{...command,shortcut:"⌃⌘Z"}:command)
    }]});
  })()`);
  await page.keyboard.press("Control+Meta+z");
  await page.waitForFunction(expected => Math.abs(scrollY - expected) <= 2, firstStep.top + distance, { timeout: 4000 });
  await page.waitForTimeout(100);
  await page.evaluate(top => scrollTo({ top, behavior: "instant" }), firstStep.top);
  await page.waitForTimeout(100);
  console.log("PASS: Arc's exact ⌃⌘Z binding triggers one smooth 30% page-key step");
  const beforeQueue = firstStep.top;
  await animateStep(1);
  await animateStep(1);
  await page.waitForFunction(expected => Math.abs(scrollY - expected) <= 2, beforeQueue + 2 * distance, { timeout: 4000 });
  await page.waitForTimeout(100);
  const beforeFull = await page.evaluate(() => scrollY);
  const fullHeight = await page.evaluate(() => innerHeight);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+Digit8" : "Control+Shift+Digit8");
  await page.waitForFunction(expected => Math.abs(scrollY - expected) <= 1.5, beforeFull + fullHeight, { timeout: 4000 });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.scrollingElement.style.getPropertyValue("scroll-behavior")), "", "The page's original inline styles should be restored");
  console.log("PASS: both shortcuts scroll down: 30% and a full viewport, with separate queued steps for rapid presses");

  await animateStep(1);
  await page.waitForTimeout(100);
  await worker.evaluate(async () => {
    const { smoothScrollSettings } = await chrome.storage.local.get("smoothScrollSettings");
    await chrome.storage.local.set({ smoothScrollSettings: { ...smoothScrollSettings, enabled: false } });
  });
  await page.waitForTimeout(100);
  const disabledAt = await page.evaluate(() => scrollY);
  await page.waitForTimeout(550);
  assert.equal(await page.evaluate(() => scrollY), disabledAt, "Disabling the switch should stop both active and future shortcut movements");
  await worker.evaluate(async () => {
    const { smoothScrollSettings } = await chrome.storage.local.get("smoothScrollSettings");
    await chrome.storage.local.set({ smoothScrollSettings: { ...smoothScrollSettings, enabled: true } });
  });
  console.log("PASS: disabling the switch immediately cancels the current animation");

  await animateStep(1);
  await page.waitForTimeout(100);
  await clickToolbar(page);
  await waitBadge("");
  const stoppedAt = await page.evaluate(() => scrollY);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+Digit9" : "Control+Shift+Digit9");
  await page.waitForTimeout(550);
  assert.equal(await page.evaluate(() => scrollY), stoppedAt, "Stopping the recording should cancel an active animation");
  console.log("PASS: stopping recording cancels the remaining animated movement");

  await clickToolbar(page);
  await waitBadge("REC");
  await page.waitForTimeout(1_000);
  await page.close();
  await waitBadge("");
  const completed = await worker.evaluate(() => chrome.downloads.search({ state: "complete" }));
  assert.equal(completed.filter(item => item.byExtensionId === extensionId).length, 3);
  console.log("PASS: repeated recordings and auto-save when the recorded tab closes");

  const files = await worker.evaluate(async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    return contexts.length;
  });
  assert.equal(files, 1, "Only one offscreen document should exist");
  const report = { browser: context.browser()?.version(), windowSize: { width: 640, height: automaticHeight }, scrolling: { stepPercent: 30, fullViewportPercent: 100, durationMs: 400, shortcuts: assigned, pageKeyboardFallback: true, arcControlCommandZ: true }, video, bytes: bytes.length, recording: videoPath, checks: 15 };
  await writeFile(path.join(output, "browser-report.json"), JSON.stringify(report, null, 2));
  console.log(`Browser smoke test passed. Recording: ${videoPath}`);
} catch (error) {
  if (context) {
    const diagnosticWorker = context.serviceWorkers()[0];
    if (diagnosticWorker) console.log("Extension diagnostics:", await diagnosticWorker.evaluate(async () => ({
      commands: globalThis.testCommandEvents,
      state: await chrome.runtime.sendMessage({ target: "recorder", type: "STATUS" }),
      settings: await chrome.storage.local.get("smoothScrollSettings"),
    })).catch(() => ({})));
    const page = context.pages()[0];
    if (page) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
