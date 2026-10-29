import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "test-results");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "page-recorder-mobile-"));
const server = createServer((request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    ...(request.url === "/blocked-xfo" ? { "X-Frame-Options": "DENY" } : { "Content-Security-Policy": "frame-ancestors 'none'" }),
  });
  response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mobile recording test</title><style>
    body{margin:0;min-height:5000px;background:#f6efdc;color:#172033;font:24px system-ui}
    header{position:sticky;top:0;padding:18px;background:#e77a5b}footer{position:fixed;bottom:0;background:#9dd7ee;width:100%;height:45px}
    @media(max-width:500px){header{background:#8ee4a5}}canvas{display:block;margin:25px auto;width:80%;height:200px}
    </style></head><body><header>${request.url === "/next" ? "Mobile navigation survived" : "Responsive mobile viewport"}</header>
    <input id="kept-input" value="Original page state"><a href="/next" style="cursor:crosshair!important">Next page</a><canvas width="300" height="200"></canvas><footer>Fixed mobile footer</footer>
    <script>const x=document.querySelector('canvas').getContext('2d');function draw(t){x.fillStyle='#f6efdc';x.fillRect(0,0,300,200);x.fillStyle='#e52f41';x.beginPath();x.arc(150+Math.sin(t/500)*80,100,25,0,Math.PI*2);x.fill();requestAnimationFrame(draw)}requestAnimationFrame(draw)</script></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: process.env.HEADED !== "1", channel: "chromium", viewport: null,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, "--enable-unsafe-extension-debugging", "--window-size=1000,760", "--window-position=0,0", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).hostname;
  const cdp = await context.browser().newBrowserCDPSession();
  await worker.evaluate(async () => {
    const window = await chrome.windows.getLastFocused();
    await chrome.windows.update(window.id, { width: 1000, height: 760, left: 0, top: 0 });
  });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: output });
  if (process.env.DEBUG_RECORDER === "1") context.on("console", message => console.log(`BROWSER ${message.type()}: ${message.text()}`));
  async function clickToolbar(page) {
    await page.bringToFront();
    const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
    const target = targetInfos.find(item => item.type === "tab" && item.url === page.url());
    assert.ok(target);
    await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId });
  }
  async function waitBadge(expected, titlePattern) {
    for (let attempt = 0; attempt < 250; attempt++) {
      const badge = await worker.evaluate(() => chrome.action.getBadgeText({}));
      if (badge === expected && (!titlePattern || titlePattern.test(await worker.evaluate(() => chrome.action.getTitle({}))))) return;
      if (badge === "!" && expected !== "!" && attempt > 2) {
        const title = await worker.evaluate(() => chrome.action.getTitle({}));
        if (!/starting recording|saving video/.test(title)) throw new Error(title);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Expected badge '${expected}': ${await worker.evaluate(() => chrome.action.getTitle({}))}`);
  }
  async function bounds() {
    return worker.evaluate(async () => {
      const { width, height, top, left, state } = await chrome.windows.getLastFocused();
      return { width, height, top, left, state };
    });
  }
  async function previewStatus() {
    return worker.evaluate(async () => {
      const session = (await chrome.storage.session.get("nativeMobileViewport")).nativeMobileViewport;
      const available = await chrome.tabs.get(session.tabId);
      const scale = Math.min(available.width / session.width, available.height / session.height);
      return { width: session.width, height: session.height, scale, available: { width: available.width, height: available.height } };
    });
  }

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.waitForFunction(() => !document.querySelector("#mobile-enabled").disabled);
  assert.equal(await options.locator("#mobile-enabled").isChecked(), false);
  assert.equal(await options.locator("#mobile-width").inputValue(), "390");
  assert.equal(await options.locator("#mobile-height").inputValue(), "844");
  await options.locator("#mobile-enabled").check();
  await options.locator("#mobile-width").fill("390");
  await options.locator("#mobile-height").fill("844");
  await options.getByRole("button", { name: "Save mobile dimensions" }).click();
  await options.locator("#mobile-status").filter({ hasText: "Saved mobile viewport: 390 × 844 px." }).waitFor();
  await options.reload();
  await options.waitForFunction(() => !document.querySelector("#mobile-enabled").disabled);
  assert.equal(await options.locator("#mobile-enabled").isChecked(), true);
  assert.equal(await options.locator("#mobile-height").inputValue(), "844");
  await options.screenshot({ path: path.join(output, "mobile-options.png"), fullPage: true });
  await options.close();
  await worker.evaluate(() => chrome.storage.local.set({ recordingWindowWidth: 640, smoothScrollSettings: { enabled: true, easing: "smootherstep", durationMs: 400, stepPercent: 30 } }));
  console.log("PASS: mobile switch and dimensions persist in Options");

  const page = await context.newPage();
  await page.goto(origin);
  await page.locator("#kept-input").fill("Unsaved state survives mobile mode");
  await page.evaluate(() => scrollTo(0, 180));
  const beforeBounds = await bounds();
  const beforeViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await clickToolbar(page);
  await waitBadge("REC");
  assert.deepEqual(await bounds(), beforeBounds, "Mobile recording must not resize or move the browser window");
  const frame = page.mainFrame();
  assert.equal(page.frames().length, 1);
  assert.equal(await page.locator("#kept-input").inputValue(), "Unsaved state survives mobile mode");
  assert.deepEqual(await frame.evaluate(() => ({ width: innerWidth, height: innerHeight, responsive: matchMedia("(max-width:500px)").matches })), { width: 390, height: 844, responsive: true });
  const preview = await previewStatus();
  assert.ok(preview.scale > 0);
  assert.ok(Math.abs(390 * preview.scale / (844 * preview.scale) - 1170 / 2532) < .0001);
  assert.equal(await frame.evaluate(() => document.querySelector("footer").getBoundingClientRect().bottom), 844);
  assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector("a")).cursor), "none");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("a")).cursor), "none");
  await page.mouse.move(30, 100);
  console.log("PASS: native responsive 390 × 844 viewport keeps the original DOM, browser bounds, fixed footer, and hidden cursor");

  const percentKey = process.platform === "darwin" ? "Meta+Shift+Digit9" : "Control+Shift+Digit9";
  const fullKey = process.platform === "darwin" ? "Meta+Shift+Digit8" : "Control+Shift+Digit8";
  await page.bringToFront();
  await page.evaluate(() => window.focus());
  const initialScroll = await frame.evaluate(() => scrollY);
  await page.keyboard.press(percentKey);
  await frame.waitForFunction(expected => Math.abs(scrollY - expected) <= 1.5, initialScroll + 844 * .3);
  await page.waitForTimeout(100);
  const first = await frame.evaluate(() => scrollY);
  await page.keyboard.press(fullKey);
  await frame.waitForFunction(expected => Math.abs(scrollY - expected) <= 1.5, first + 844);
  await page.waitForTimeout(100);
  console.log("PASS: both shortcuts scroll the native mobile viewport by its own height");

  await frame.goto(`${origin}/next`);
  await frame.getByText("Mobile navigation survived", { exact: true }).waitFor();
  await frame.waitForFunction(() => getComputedStyle(document.querySelector("a")).cursor === "none");
  await page.keyboard.press(percentKey);
  await frame.waitForFunction(() => Math.abs(scrollY - 844 * .3) <= 1.5);
  await page.waitForTimeout(100);
  console.log("PASS: same-origin mobile navigation keeps recording and reattaches shortcut handling");
  const recordingStartedAt = await worker.evaluate(async () => (await chrome.runtime.sendMessage({ target: "recorder", type: "STATUS" })).status.startedAt);
  await worker.evaluate(async () => {
    const window = await chrome.windows.getLastFocused();
    await chrome.windows.update(window.id, { width: 900, height: 700 });
  });
  const resizedVideoTime = (Date.now() - recordingStartedAt) / 1000 + .3;
  await page.waitForTimeout(700);
  await worker.evaluate(async bounds => {
    const window = await chrome.windows.getLastFocused();
    await chrome.windows.update(window.id, { width: bounds.width, height: bounds.height, top: bounds.top, left: bounds.left });
  }, beforeBounds);
  await page.waitForTimeout(150);
  await clickToolbar(page);
  await waitBadge("");
  await page.waitForFunction(() => !document.querySelector("dialog"));
  assert.equal(page.frames().length, 1);
  assert.deepEqual(await bounds(), beforeBounds);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("a")).cursor), "crosshair");
  await page.waitForFunction(expected => innerWidth === expected.width && innerHeight === expected.height, beforeViewport);
  const desktopSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.deepEqual(desktopSize, beforeViewport);
  assert.equal(await worker.evaluate(() => chrome.storage.session.get("nativeMobileViewport").then(result => result.nativeMobileViewport)), undefined);
  console.log("PASS: stopping restores the desktop viewport and cursor and detaches the debugger without resizing the window");

  const [download] = await worker.evaluate(() => chrome.downloads.search({ orderBy: ["-startTime"] }));
  const videoPath = path.join(output, `mobile-recording${path.extname(download.filename)}`);
  await writeFile(videoPath, await readFile(download.filename));
  await page.setContent('<input type="file"><video muted></video>');
  await page.locator('input[type="file"]').setInputFiles(videoPath);
  const video = await page.evaluate(async resizedVideoTime => {
    const element = document.querySelector("video");
    element.src = URL.createObjectURL(document.querySelector("input").files[0]);
    await new Promise((resolve, reject) => { element.onloadeddata = resolve; element.onerror = reject; });
    await element.play();
    await new Promise(resolve => setTimeout(resolve, 200));
    element.pause();
    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth; canvas.height = element.videoHeight;
    const context = canvas.getContext("2d"); context.drawImage(element, 0, 0);
    const pixel = (x,y) => [...context.getImageData(x,y,1,1).data].slice(0,3);
    const signature = () => context.getImageData(0, 0, canvas.width, Math.min(300, canvas.height)).data.reduce((sum, value, index) => (sum + value * (index % 13 + 1)) % 1000000007, 0);
    const firstSignature = signature();
    const result = { width: canvas.width, height: canvas.height, left: pixel(5, canvas.height / 2), right: pixel(canvas.width - 5, canvas.height / 2), center: pixel(canvas.width / 2, canvas.height / 2), footer: pixel(canvas.width / 2, canvas.height - 10), frame: canvas.toDataURL() };
    await new Promise(resolve => { element.onseeked = resolve; element.currentTime = .8; });
    context.drawImage(element, 0, 0);
    const motionChanged = signature() !== firstSignature;
    await new Promise(resolve => { element.onseeked = resolve; element.currentTime = resizedVideoTime; });
    context.drawImage(element, 0, 0);
    return { ...result, motionChanged, resizedLeft: pixel(5, canvas.height / 2), resizedFooter: pixel(canvas.width / 2, canvas.height - 10) };
  }, resizedVideoTime);
  await writeFile(path.join(output, "mobile-video-frame.png"), Buffer.from(video.frame.split(",")[1], "base64"));
  delete video.frame;
  assert.equal(video.width, 390);
  assert.equal(video.height, 844);
  assert.ok(video.left.every(value => value > 100) && video.right.every(value => value > 100), JSON.stringify(video));
  assert.ok(video.center.some(value => value > 100), JSON.stringify(video));
  assert.ok(video.footer[1] > 150 && video.footer[2] > 150, JSON.stringify(video));
  assert.equal(video.motionChanged, true);
  assert.ok(video.resizedLeft.every(value => value > 100), JSON.stringify(video));
  assert.ok(video.resizedFooter[1] > 150 && video.resizedFooter[2] > 150, JSON.stringify(video));
  console.log("PASS: mobile cropping follows changes in the available tab size");
  console.log("PASS: downloaded video is exactly 390 × 844, excludes surrounding space, preserves the footer, and plays moving frames", video);

  await worker.evaluate(() => chrome.storage.local.set({ mobileViewportSettings: { enabled: true, width: 391, height: 845 } }));
  await page.goto(origin);
  await clickToolbar(page);
  await waitBadge("REC");
  await page.waitForTimeout(700);
  await clickToolbar(page);
  await waitBadge("");
  const [oddDownload] = await worker.evaluate(() => chrome.downloads.search({ orderBy: ["-startTime"] }));
  const oddVideoPath = path.join(output, `mobile-odd-recording${path.extname(oddDownload.filename)}`);
  await writeFile(oddVideoPath, await readFile(oddDownload.filename));
  await page.setContent('<input type="file"><video muted></video>');
  await page.locator('input[type="file"]').setInputFiles(oddVideoPath);
  const oddSize = await page.evaluate(async () => {
    const video = document.querySelector("video");
    video.src = URL.createObjectURL(document.querySelector("input").files[0]);
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
    return { width: video.videoWidth, height: video.videoHeight };
  });
  assert.deepEqual(oddSize, { width: 391, height: 845 });
  console.log("PASS: odd mobile dimensions are preserved exactly using a compatible encoder");
  await worker.evaluate(() => chrome.storage.local.set({ mobileViewportSettings: { enabled: true, width: 390, height: 844 } }));

  await page.goto(origin);
  await clickToolbar(page);
  await waitBadge("REC");
  await page.waitForTimeout(500);
  await page.goto(`${origin.replace("127.0.0.1", "localhost")}/next`).catch(() => {});
  await waitBadge("!");
  assert.match(await worker.evaluate(() => chrome.action.getTitle({})), /available video was saved/i);
  assert.equal(page.frames().length, 1);
  assert.deepEqual(await bounds(), beforeBounds);
  console.log("PASS: leaving the mobile origin stops, saves the available video, and restores the original tab");

  for (const policy of ["xfo", "csp"]) {
    const blocked = await context.newPage();
    await blocked.goto(`${origin}/blocked-${policy}`);
    await clickToolbar(blocked);
    await waitBadge("REC");
    assert.equal(blocked.frames().length, 1);
    assert.deepEqual(await blocked.evaluate(() => ({ width: innerWidth, height: innerHeight })), { width: 390, height: 844 });
    await blocked.waitForTimeout(650);
    await clickToolbar(blocked);
    await waitBadge("");
    assert.equal(await blocked.evaluate(() => getComputedStyle(document.querySelector("a")).cursor), "crosshair");
    await blocked.close();
    console.log(`PASS: ${policy.toUpperCase()} embedding restrictions do not prevent native mobile recording`);
  }

  // A small CSS viewport must also scale up, preserving the reference ratio.
  await worker.evaluate(() => chrome.storage.local.set({ mobileViewportSettings: { enabled: true, width: 195, height: 422 } }));
  await page.goto(origin);
  await clickToolbar(page);
  await waitBadge("REC");
  const fitted = await previewStatus();
  assert.ok(fitted.scale > 1);
  assert.ok(Math.abs(fitted.height * fitted.scale - fitted.available.height) <= 1 || Math.abs(fitted.width * fitted.scale - fitted.available.width) <= 1);
  assert.ok(Math.abs(fitted.width / fitted.height - 1170 / 2532) < .0001);
  await page.waitForTimeout(650);
  await clickToolbar(page);
  await waitBadge("");
  console.log("PASS: native mobile preview scales up to use the available space without changing the reference aspect ratio");

  // Closing the recorded tab releases capture and the owned debugger session.
  await page.goto(origin);
  await clickToolbar(page);
  await waitBadge("REC");
  await page.waitForTimeout(650);
  await page.close();
  for (let attempt = 0; attempt < 200; attempt++) {
    const status = await worker.evaluate(() => chrome.runtime.sendMessage({ target: "recorder", type: "STATUS" }).then(result => result.status));
    if (["idle", "error"].includes(status.phase)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const closedStatus = await worker.evaluate(() => chrome.runtime.sendMessage({ target: "recorder", type: "STATUS" }).then(result => result.status));
  assert.ok(["idle", "error"].includes(closedStatus.phase));
  assert.equal(await worker.evaluate(() => chrome.storage.session.get("nativeMobileViewport").then(result => result.nativeMobileViewport)), undefined);
  const [closedDownload] = await worker.evaluate(() => chrome.downloads.search({ orderBy: ["-startTime"] }));
  assert.equal(closedDownload.state, "complete");
  assert.ok(closedDownload.fileSize > 0);
  console.log("PASS: closing the mobile tab saves the available video and releases the debugger session");
  await writeFile(path.join(output, "mobile-report.json"), JSON.stringify({ browser: context.browser().version(), viewport: { width: 390, height: 844 }, browserWindow: beforeBounds, preview, video, oddSize, cursorHidden: true, recording: videoPath, checks: 13 }, null, 2));
} catch (error) {
  if (context) {
    console.log("Mobile diagnostics:", await context.serviceWorkers()[0]?.evaluate(async () => ({ title: await chrome.action.getTitle({}), status: await chrome.runtime.sendMessage({ target: "recorder", type: "STATUS" }) })).catch(() => ({})));
    await context.pages().at(-1)?.screenshot({ path: path.join(output, "mobile-failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
