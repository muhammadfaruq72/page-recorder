import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "test-results");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "page-recorder-native-"));
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end('<!doctype html><html><head><title>Page Recorder — Native shortcut test</title><style>html{scroll-behavior:smooth}body{margin:0;min-height:4000px;padding:40px;color:white;background:linear-gradient(#14263d,#3a765a);font:24px system-ui}h1{font-size:32px}p{max-width:500px}</style></head><body><h1>Page Recorder shortcut test</h1><p>Press the scrolling shortcuts when the terminal says READY.</p><p>Both scroll down over half a second: first 30%, then a full viewport.</p></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: false, channel: "chromium", viewport: null,
    ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, "--enable-unsafe-extension-debugging", "--window-size=900,800"],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).hostname;
  await worker.evaluate(() => {
    globalThis.nativeCommands = [];
    chrome.commands.onCommand.addListener(command => globalThis.nativeCommands.push(command));
    return chrome.storage.local.set({
      recordingWindowWidth: 640,
      smoothScrollSettings: { enabled: true, easing: "smootherstep", durationMs: 500, stepPercent: 30 },
    });
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const cdp = await context.browser().newBrowserCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: output });
  const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] });
  const target = targetInfos.find(item => item.type === "tab" && item.url === page.url());
  await page.bringToFront();
  await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId });
  for (let i = 0; i < 100 && await worker.evaluate(() => chrome.action.getBadgeText({})) !== "REC"; i++) {
    await page.waitForTimeout(100);
  }
  assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), "REC");
  const distance = await page.evaluate(() => innerHeight * .3);
  const modifier = process.platform === "darwin" ? "Command" : "Ctrl";
  console.log(`READY DOWN: press ${modifier}+Shift+9 in the test browser window.`);
  await page.waitForFunction(expected => Math.abs(scrollY - expected) <= 1.5, distance, { timeout: 60000 });
  await page.waitForTimeout(150);
  const downPosition = await page.evaluate(() => scrollY);
  assert.ok((await worker.evaluate(() => globalThis.nativeCommands)).includes("scroll-down"));
  const fullHeight = await page.evaluate(() => innerHeight);
  console.log(`PASS: native percentage shortcut moved ${downPosition}px. READY FULL VIEWPORT: press ${modifier}+Shift+8.`);
  await page.waitForFunction(expected => Math.abs(scrollY - expected) <= 1.5, downPosition + fullHeight, { timeout: 60000 });
  const fullPosition = await page.evaluate(() => scrollY);
  const commands = await worker.evaluate(() => globalThis.nativeCommands);
  assert.ok(commands.includes("scroll-up"));
  await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId });
  for (let i = 0; i < 100 && await worker.evaluate(() => chrome.action.getBadgeText({})) !== ""; i++) {
    await page.waitForTimeout(100);
  }
  assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), "");
  await writeFile(path.join(output, "native-shortcuts-report.json"), JSON.stringify({ browser: context.browser().version(), commands, distance, downPosition, fullHeight, fullPosition, checks: 2 }, null, 2));
  console.log("PASS: both native shortcuts reached Chrome's command handler and animated the recorded page.");
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
