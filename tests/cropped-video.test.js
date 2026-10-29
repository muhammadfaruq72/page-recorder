import test from "node:test";
import assert from "node:assert/strict";
import { sourceCropRect } from "../cropped-video.js";

test("mobile cropping maps a scaled preview into high-resolution tab video", () => {
  const region = { left: 350, top: 0, width: 300, height: 600, viewportWidth: 1000, viewportHeight: 600 };
  assert.deepEqual(sourceCropRect(region, 2000, 1200), { x: 700, y: 0, width: 600, height: 1200 });
});

test("mobile cropping excludes capture-driver letterboxing after a browser resize", () => {
  const region = { left: 100, top: 0, width: 300, height: 600, viewportWidth: 500, viewportHeight: 600 };
  assert.deepEqual(sourceCropRect(region, 2000, 1200), { x: 700, y: 0, width: 600, height: 1200 });
  const landscape = { left: 350, top: 0, width: 300, height: 600, viewportWidth: 1000, viewportHeight: 600 };
  assert.deepEqual(sourceCropRect(landscape, 1000, 1000), { x: 350, y: 200, width: 300, height: 600 });
});

test("invalid mobile crop metadata is rejected", () => {
  for (const invalid of [null, {}, { left: 0, top: 0, width: 0, height: 10, viewportWidth: 100, viewportHeight: 100 }]) {
    assert.throws(() => sourceCropRect(invalid, 100, 100), /capture area/);
  }
});

test("desktop recording bypasses canvas processing and returns source stream directly for full GPU performance", async () => {
  const { prepareRecordingVideo } = await import("../cropped-video.js");
  const dummyStream = { id: "gpu-stream", getVideoTracks: () => [{ getSettings: () => ({ width: 3840, height: 2160 }) }] };
  const result = await prepareRecordingVideo(dummyStream, null, { outputWidth: 3840, outputHeight: 2160 });
  assert.equal(result.stream, dummyStream);
});


test("native mobile capture passes the exact 3x surface directly to the encoder", async () => {
  const { prepareRecordingVideo } = await import("../cropped-video.js");
  const stream = { getVideoTracks: () => [{ getSettings: () => ({ width: 1170, height: 2532 }) }] };
  const prepared = await prepareRecordingVideo(stream, { nativeSurface: true, outputWidth: 1170, outputHeight: 2532 }, { frameRate: 60 });
  assert.equal(prepared.stream, stream);
  assert.equal(prepared.release, undefined);
  assert.equal(prepared.stats().path, "Native mobile capture");
});
