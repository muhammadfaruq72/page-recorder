import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const archive = fileURLToPath(new URL("../dist/page-recorder.zip", import.meta.url));
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await rm(archive, { force: true });
const files = ["manifest.json", "background.js", "offscreen.html", "offscreen.js", "recorder.js", "recording-file.js", "recording-file-worker.js", "settings.js", "window-size.js", "smooth-scroll.js", "recording-shortcuts.js", "mobile-viewport.js", "recording-cursor.js", "cropped-video.js", "options.html", "options.js", "options.css", "README.md", "icons"];
const result = spawnSync("zip", ["-q", "-r", archive, ...files], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Extension packaged: ${archive}`);
