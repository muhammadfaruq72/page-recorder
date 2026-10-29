import test from "node:test";
import assert from "node:assert/strict";
import { PageRecorder, FPS, BITRATE, CHUNK_MS, captureSize, recordingFilename, videoExtension } from "../recorder.js";

const tick = () => new Promise(resolve => setImmediate(resolve));

async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail("Timed out waiting for recorder state");
}

function setup(overrides = {}) {
  const statuses = [];
  const written = [];
  const downloads = [];
  const revoked = [];
  const track = new EventTarget();
  track.readyState = "live";
  track.getSettings = () => ({ width: 3840, height: 2160, frameRate: 30 });
  track.applyConstraints = async constraints => { track.constraints = constraints; };
  track.stop = () => { track.readyState = "ended"; };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const file = {
    discarded: false,
    closed: false,
    async write(blob) { written.push(await blob.text()); },
    async finish() { file.closed = true; return new Blob(written); },
    async discard() { file.discarded = true; },
  };
  class FakeMediaRecorder extends EventTarget {
    static isTypeSupported(type) { return type.startsWith("video/mp4"); }
    constructor(input, options) {
      super();
      this.input = input;
      this.options = options;
      this.mimeType = options.mimeType || "video/webm";
      this.state = "inactive";
    }
    start(timeslice) { this.timeslice = timeslice; this.state = "recording"; }
    data(text) {
      const event = new Event("dataavailable");
      event.data = new Blob([text]);
      this.dispatchEvent(event);
    }
    stop() {
      assert.equal(this.state, "recording");
      this.state = "inactive";
      queueMicrotask(() => {
        this.data("last chunk");
        this.dispatchEvent(new Event("stop"));
      });
    }
  }
  const dependencies = {
    getMedia: async constraints => { dependencies.constraints = constraints; return stream; },
    MediaRecorderClass: FakeMediaRecorder,
    createFile: async () => file,
    download: async (url, filename) => { downloads.push({ url, filename }); },
    onStatus: status => statuses.push(status),
    urls: { createObjectURL: () => "blob:test-video", revokeObjectURL: url => revoked.push(url) },
    ...overrides,
  };
  const recorder = new PageRecorder(dependencies);
  return { recorder, statuses, written, downloads, revoked, track, stream, file, dependencies, FakeMediaRecorder };
}

test("start requests only tab video at the supplied quality and publishes recording", async () => {
  const h = setup();
  await h.recorder.start("stream-id", 12);
  assert.equal(h.dependencies.constraints.audio, false);
  assert.equal(h.dependencies.constraints.video.mandatory.chromeMediaSourceId, "stream-id");
  assert.equal(h.dependencies.constraints.video.mandatory.maxFrameRate, FPS);
  assert.equal(h.recorder.recorder.options.videoBitsPerSecond, BITRATE);
  assert.equal(h.recorder.recorder.timeslice, CHUNK_MS);
  assert.equal(h.track.constraints.frameRate.ideal, 60);
  assert.equal(h.track.constraints.cursor, "never");
  assert.equal(h.recorder.status.phase, "recording");
  assert.equal(h.recorder.status.tabId, 12);
});

test("mobile recordings encode the prepared cropped stream and release both streams", async () => {
  const output = new EventTarget();
  output.readyState = "live";
  output.getSettings = () => ({ width: 390, height: 844, frameRate: 60 });
  output.stop = () => { output.readyState = "ended"; };
  const cropped = { getTracks: () => [output], getVideoTracks: () => [output] };
  let released = 0;
  let input;
  const mobile = { width: 390, height: 844, region: { left: 300, top: 0, width: 390, height: 844, viewportWidth: 990, viewportHeight: 844 } };
  const h = setup({ prepareVideo: async (source, crop) => { input = { source, crop }; return { stream: cropped, release: () => { released++; } }; } });
  await h.recorder.start("stream", 12, { width: 990, height: 844, mobile });
  assert.equal(input.source, h.stream);
  assert.equal(input.crop, mobile);
  assert.equal(h.recorder.recorder.input, cropped);
  assert.equal(h.recorder.status.settings.width, 390);
  assert.equal(h.recorder.status.settings.height, 844);
  h.recorder.stop();
  await waitFor(() => h.recorder.status.phase === "idle");
  assert.equal(released, 1);
  assert.equal(h.track.readyState, "ended");
  assert.equal(output.readyState, "ended");
});

test("stop includes the final chunk, saves once, and releases disk and capture", async () => {
  const h = setup();
  await h.recorder.start("stream", 1);
  h.recorder.recorder.data("first chunk");
  h.recorder.stop();
  h.recorder.stop();
  await waitFor(() => h.recorder.status.phase === "idle");
  assert.deepEqual(h.written, ["first chunk", "last chunk"]);
  assert.equal(h.downloads.length, 1);
  assert.match(h.downloads[0].filename, /^Page Recorder\/recording-.*\.mp4$/);
  assert.equal(h.track.readyState, "ended");
  assert.equal(h.file.closed, true);
  assert.equal(h.file.discarded, true);
  assert.deepEqual(h.revoked, ["blob:test-video"]);
});

test("a mobile preview error stops and saves the available video with its reason", async () => {
  const h = setup();
  await h.recorder.start("stream", 1);
  h.recorder.recorder.data("mobile frames");
  h.recorder.stop("The mobile view left its website.");
  await waitFor(() => h.recorder.status.phase === "error");
  assert.match(h.recorder.status.error, /mobile view left its website.*available video was saved/i);
  assert.equal(h.downloads.length, 1);
  assert.equal(h.track.readyState, "ended");
  assert.equal(h.file.discarded, true);
});

test("disk writes are ordered and finish waits for a slow write", async () => {
  const h = setup();
  let allowWrite;
  const gate = new Promise(resolve => { allowWrite = resolve; });
  const write = h.file.write;
  h.file.write = async blob => { await gate; await write(blob); };
  await h.recorder.start("stream", 1);
  h.recorder.recorder.data("one");
  h.recorder.recorder.data("two");
  h.recorder.stop();
  await tick();
  assert.equal(h.file.closed, false);
  assert.equal(h.downloads.length, 0);
  allowWrite();
  await waitFor(() => h.recorder.status.phase === "idle");
  assert.deepEqual(h.written, ["one", "two", "last chunk"]);
});

test("a failed download retains the file and URL until a successful retry", async () => {
  const h = setup();
  let calls = 0;
  h.recorder.download = async () => { if (++calls === 1) throw new Error("Download interrupted"); };
  await h.recorder.start("stream", 1);
  h.recorder.stop();
  await waitFor(() => h.recorder.status.phase === "error");
  assert.equal(h.recorder.status.retryAvailable, true);
  assert.equal(h.file.discarded, false);
  assert.equal(h.revoked.length, 0);
  await assert.rejects(h.recorder.start("another-stream", 2), /already in progress/);
  await h.recorder.retrySave();
  assert.equal(calls, 2);
  assert.equal(h.recorder.status.phase, "idle");
  assert.equal(h.file.discarded, true);
  assert.equal(h.revoked.length, 1);
});

test("the temporary file is retained while Chrome is still downloading", async () => {
  let complete;
  const h = setup({ download: () => new Promise(resolve => { complete = resolve; }) });
  await h.recorder.start("stream", 1);
  h.recorder.stop();
  await waitFor(() => Boolean(complete));
  assert.equal(h.recorder.status.phase, "saving");
  assert.equal(h.file.discarded, false);
  assert.equal(h.revoked.length, 0);
  complete();
  await waitFor(() => h.recorder.status.phase === "idle");
});

test("ending tab capture automatically stops and saves", async () => {
  const h = setup();
  await h.recorder.start("stream", 1);
  h.track.readyState = "ended";
  h.track.dispatchEvent(new Event("ended"));
  await waitFor(() => h.recorder.status.phase === "idle");
  assert.equal(h.downloads.length, 1);
});

test("denied capture reports an error and can be started again", async () => {
  const h = setup({ getMedia: async () => { throw new DOMException("Denied", "NotAllowedError"); } });
  await assert.rejects(h.recorder.start("stream", 1), /did not allow/);
  assert.equal(h.recorder.status.phase, "error");
  h.recorder.getMedia = async () => h.stream;
  await h.recorder.start("new-stream", 1);
  assert.equal(h.recorder.status.phase, "recording");
});

test("file creation failure releases the capture stream", async () => {
  const h = setup({ createFile: async () => { throw new DOMException("Full", "QuotaExceededError"); } });
  await assert.rejects(h.recorder.start("stream", 1), /disk is full/);
  assert.equal(h.track.readyState, "ended");
});

test("disk write failure stops recording and does not download corrupt data", async () => {
  const h = setup();
  h.file.write = async () => { throw new DOMException("Full", "QuotaExceededError"); };
  await h.recorder.start("stream", 1);
  h.recorder.recorder.data("data");
  await waitFor(() => h.recorder.status.phase === "error");
  assert.match(h.recorder.status.error, /disk is full/);
  assert.equal(h.recorder.status.retryAvailable, false);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.file.discarded, true);
  assert.equal(h.track.readyState, "ended");
});

test("encoder errors save available data and report the early end", async () => {
  const h = setup();
  await h.recorder.start("stream", 1);
  h.recorder.recorder.data("partial recording");
  const event = new Event("error");
  event.error = new Error("Encoder failed");
  h.recorder.recorder.dispatchEvent(event);
  await waitFor(() => h.recorder.status.phase === "error");
  assert.equal(h.downloads.length, 1);
  assert.match(h.recorder.status.error, /ended early/);
  assert.equal(h.file.discarded, true);
});

test("an asynchronous encoder failure before any data automatically tries the next codec", async () => {
  const h = setup();
  await h.recorder.start("stream", 1);
  const failedEncoder = h.recorder.recorder;
  failedEncoder.state = "inactive";
  const event = new Event("error");
  event.error = new Error("Unsupported encoder configuration");
  failedEncoder.dispatchEvent(event);
  failedEncoder.dispatchEvent(new Event("stop"));
  assert.notEqual(h.recorder.recorder, failedEncoder);
  assert.equal(h.recorder.recorder.mimeType, "video/webm");
  assert.equal(h.track.readyState, "live");
  assert.equal(h.recorder.status.phase, "recording");
  h.recorder.stop();
  await waitFor(() => h.recorder.status.phase === "idle");
  assert.match(h.downloads[0].filename, /\.webm$/);
});

test("H.264 capture is constrained proportionally for landscape and portrait", async () => {
  for (const [width, height, expectedWidth, expectedHeight] of [[4096, 3000, 3145, 2304], [3000, 4096, 2304, 3145]]) {
    const h = setup();
    h.track.getSettings = () => ({ width, height });
    await h.recorder.start("stream", 1);
    assert.equal(h.track.constraints.width.ideal, expectedWidth);
    assert.equal(h.track.constraints.height.ideal, expectedHeight);
  }
});

test("concurrent start calls cannot acquire two streams", async () => {
  const h = setup();
  const first = h.recorder.start("stream", 1);
  await assert.rejects(h.recorder.start("stream2", 2), /already in progress/);
  await first;
});

test("a second recording works after the first download completes", async () => {
  const h = setup();
  await h.recorder.start("stream1", 1);
  h.recorder.stop();
  await waitFor(() => h.recorder.status.phase === "idle");
  const track = new EventTarget();
  Object.assign(track, { readyState: "live", getSettings: () => ({}), applyConstraints: async () => {}, stop: () => {} });
  h.recorder.getMedia = async () => ({ getTracks: () => [track], getVideoTracks: () => [track] });
  await h.recorder.start("stream2", 2);
  assert.equal(h.recorder.status.tabId, 2);
});

test("filename extensions reflect the actual recording container", () => {
  assert.equal(videoExtension("video/mp4;codecs=avc1"), "mp4");
  assert.equal(videoExtension("video/x-matroska;codecs=avc1"), "mkv");
  assert.equal(videoExtension("video/webm;codecs=vp8"), "webm");
  assert.equal(recordingFilename("video/mp4", new Date("2026-10-27T10:15:20.100Z")), "Page Recorder/recording-2026-10-27T10-15-20-100Z.mp4");
});

test("capture dimensions preserve the viewport ratio and fit hardware bounds", () => {
  assert.deepEqual(captureSize({ width: 1100, height: 760, devicePixelRatio: 2 }, true), { maxWidth: 2200, maxHeight: 1520 });
  assert.deepEqual(captureSize({ width: 3840, height: 2160, devicePixelRatio: 2 }, true), { maxWidth: 4096, maxHeight: 2304 });
  assert.deepEqual(captureSize({ width: 2160, height: 3840, devicePixelRatio: 2 }, true), { maxWidth: 2304, maxHeight: 4096 });
  assert.deepEqual(captureSize({}), {});
});
