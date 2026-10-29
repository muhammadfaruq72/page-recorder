import { recordingBitrate, DEFAULT_OUTPUT_SETTINGS } from "./settings.js";

export const FPS = 60;
export const BITRATE = 30_000_000;
export const CHUNK_MS = 1_000;
const MAX_PENDING_WRITE_BYTES = 64 * 1024 * 1024;
// Every candidate uses a real MP4 muxer. Never silently fall back to WebM.
// Prefer GPU hardware-accelerated profiles for Chromium / Arc on macOS & Windows.
export const MIME_TYPES = [
  "video/mp4;codecs=avc1.640034",
  "video/mp4;codecs=avc1.640033",
  "video/mp4;codecs=avc1.64002a",
  "video/mp4;codecs=avc1.4d402a",
  "video/mp4;codecs=avc1",
  "video/mp4;codecs=hvc1.1.6.L156.B0",
  "video/mp4;codecs=hvc1.1.6.L153.B0",
  "video/mp4;codecs=hvc1.1.6.L123.B0",
  "video/mp4;codecs=hvc1.1.6.L120.B0",
  "video/mp4;codecs=hvc1.1.6.L93.B0",
  "video/mp4;codecs=hvc1.1.6.L186.B0",
  "video/mp4;codecs=hvc1",
  "video/mp4;codecs=hev1.1.6.L156.B0",
  "video/mp4;codecs=hev1",
  "video/mp4;codecs=vp09.00.10.08",
  "video/mp4;codecs=av01.0.08M.08",
  "video/mp4",
];

export function videoExtension(mimeType = "video/mp4") {
  if (!/^video\/mp4(?:;|$)/i.test(mimeType)) throw new Error("The encoder did not produce MP4 video.");
  return "mp4";
}

export function recordingFilename(mimeType, date = new Date(), prefix = "recording") {
  return `Page Recorder/${prefix}-${date.toISOString().replace(/[:.]/g, "-")}.${videoExtension(mimeType)}`;
}

export function captureSize({ width, height, devicePixelRatio = 1, mobile, outputWidth, outputHeight } = {}, h264 = false) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return {};
  if (mobile?.outputWidth > 0 && mobile?.outputHeight > 0 && mobile.region?.width > 0 && mobile.region?.height > 0) {
    // Request enough source pixels for the mobile crop, including the unused
    // portion of the tab. Chromium's HiDPI tab capturer can rasterize above the
    // display's pixel density. A margin covers sharing-banner height changes.
    const wantedScale = Math.max(mobile.outputWidth / mobile.region.width, mobile.outputHeight / mobile.region.height) * 1.125;
    const scale = Math.min(wantedScale, 8192 / width, 8192 / height);
    const captureWidth = Math.min(8192, Math.max(2, Math.ceil(width * scale / 2) * 2));
    const captureHeight = Math.min(8192, Math.max(2, Math.ceil(height * scale / 2) * 2));
    // H.264 limits apply to the final cropped canvas, not this source stream.
    return { minWidth: captureWidth, maxWidth: captureWidth, minHeight: captureHeight, maxHeight: captureHeight };
  }
  if (outputWidth > 0 && outputHeight > 0) {
    const landscape = width >= height;
    const maxBoundW = h264 ? (landscape ? 4096 : 2304) : 8192;
    const maxBoundH = h264 ? (landscape ? 2304 : 4096) : 8192;
    const scale = Math.min(Math.max(outputWidth / width, outputHeight / height), maxBoundW / width, maxBoundH / height);
    const captureWidth = Math.min(maxBoundW, Math.max(2, Math.ceil(width * scale / 2) * 2));
    const captureHeight = Math.min(maxBoundH, Math.max(2, Math.ceil(height * scale / 2) * 2));
    return { minWidth: captureWidth, maxWidth: captureWidth, minHeight: captureHeight, maxHeight: captureHeight };
  }
  const landscape = width >= height;
  const maxWidth = h264 && !landscape ? 2304 : 4096;
  const maxHeight = h264 && landscape ? 2304 : 4096;
  const ratio = Math.min(Math.max(devicePixelRatio || 1, 1), 4);
  const scale = Math.min(ratio, maxWidth / width, maxHeight / height);
  // Use the actual tab's aspect ratio. A square 4096 × 4096 bound makes
  // Chrome allocate a square capture with large black bars around the page.
  return {
    maxWidth: Math.max(2, Math.floor(width * scale / 2) * 2),
    maxHeight: Math.max(2, Math.floor(height * scale / 2) * 2),
  };
}

export class PageRecorder {
  constructor({ getMedia, MediaRecorderClass, createFile, download, onStatus, urls = URL, prepareVideo = async stream => ({ stream }) }) {
    Object.assign(this, { getMedia, MediaRecorderClass, createFile, download, onStatus, urls });
    this.prepareVideo = prepareVideo;
    this.status = { phase: "idle" };
    this.stream = null;
    this.recorder = null;
    this.file = null;
    this.savedBlob = null;
    this.blobUrl = null;
    this.writeQueue = Promise.resolve();
    this.writeError = null;
    this.recordingError = null;
    this.finalizing = null;
    this.bytesReceived = 0;
    this.pendingWriteBytes = 0;
    this.encoderCandidates = [];
    this.nextEncoder = 0;
    this.stopReason = null;
    this.videoBitsPerSecond = BITRATE;
    this.autoStopTimer = undefined;
  }

  publish(phase, extra = {}) {
    this.status = { phase, ...(this.encodingSize ? { settings: this.encodingSize } : {}), ...extra };
    const status = this.status;
    // A sleeping/restarting service worker must never stop the video stream.
    Promise.resolve().then(() => this.onStatus(status)).catch(console.error);
  }

  async start(streamId, tabId, viewport = {}) {
    if (!["idle", "error"].includes(this.status.phase) || this.savedBlob) {
      throw new Error("A recording is already in progress.");
    }
    this.publish("starting", { tabId });
    this.writeQueue = Promise.resolve();
    this.writeError = null;
    this.recordingError = null;
    this.finalizing = null;
    this.bytesReceived = 0;
    this.pendingWriteBytes = 0;
    this.nextEncoder = 0;
    this.stopReason = null;
    this.videoBitsPerSecond = BITRATE;
    clearTimeout(this.autoStopTimer);
    this.encodingSize = undefined;
    this.autoStopTimer = undefined;
    const options = { ...DEFAULT_OUTPUT_SETTINGS, ...viewport };
    this.frameRate = options.frameRate;
    this.codec = options.codec;
    this.filenamePrefix = options.filenamePrefix;

    try {
      const mimeTypes = MIME_TYPES.filter(type => this.MediaRecorderClass.isTypeSupported(type)
        && (this.codec === "auto" || (this.codec === "h264" ? /avc1|avc3/.test(type) : /hvc1|hev1/.test(type))));
      if (!mimeTypes.length) throw new Error(this.codec === "auto"
        ? "This browser cannot record MP4. Update the browser to a version with MP4 recording support."
        : `The selected ${this.codec === "h264" ? "H.264" : "HEVC"} MP4 codec is unavailable. Choose Auto or another MP4 codec.`);
      if (this.codec === "auto" && (viewport.outputWidth || viewport.width)) {
        const estW = viewport.outputWidth || viewport.width;
        const estH = viewport.outputHeight || viewport.height;
        const largeFrame = Math.ceil(estW / 16) * Math.ceil(estH / 16) > 36864;
        if (largeFrame) mimeTypes.sort((a, b) => Number(/hvc1|hev1/.test(b)) - Number(/hvc1|hev1/.test(a)));
      }
      this.encoderCandidates = mimeTypes;
      const preferredType = mimeTypes[0];
      const isH264 = /avc1|avc3/.test(preferredType);
      this.stream = await this.getMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: streamId,
            ...captureSize(viewport, isH264),
            maxFrameRate: this.frameRate,
          },
        },
      });
      this.sourceStream = this.stream;

      const track = this.stream.getVideoTracks()[0];
      if (!track || track.readyState === "ended") throw new Error("The tab stopped sharing before recording could start.");
      const { width = 0, height = 0 } = track.getSettings();
      const landscape = width >= height;
      const maxWidth = landscape ? 4096 : 2304;
      const maxHeight = landscape ? 2304 : 4096;
      const scale = !viewport.mobile && isH264 && width && height
        ? Math.min(1, maxWidth / width, maxHeight / height)
        : 1;
      try {
        await track.applyConstraints({
          cursor: viewport.cursorVisible === false ? "never" : "always",
          frameRate: { ideal: this.frameRate, max: this.frameRate },
          ...(scale < 1 ? {
            width: { ideal: Math.floor(width * scale) },
            height: { ideal: Math.floor(height * scale) },
          } : {}),
        });
      } catch (error) {
        // Some tab capture drivers reject constraints; native capture still works.
        console.warn("Using the tab's native capture settings:", error);
      }

      this.mobileCrop = viewport.mobile;
      const prepared = await this.prepareVideo(this.sourceStream, this.mobileCrop, viewport);
      this.releaseVideo = prepared.release;
      this.requestVideoFrame = prepared.requestFrame;
      this.stream = prepared.stream;
      const recordedTrack = this.stream.getVideoTracks()[0];
      if (!recordedTrack || recordedTrack.readyState === "ended") throw new Error("The recording video is unavailable.");
      const recordedSize = recordedTrack.getSettings();
      this.encodingSize = recordedSize;
      if (viewport.outputWidth || viewport.mobile?.outputWidth) {
        // Prefer platform HEVC for frames beyond the usual H.264 Level 5.x
        // macroblock budget, retaining H.264 and generic MP4 as alternatives.
        const largeFrame = Math.ceil(recordedSize.width / 16) * Math.ceil(recordedSize.height / 16) > 36864;
        if (largeFrame && this.codec === "auto") this.encoderCandidates.sort((a, b) => Number(/hvc1|hev1/.test(b)) - Number(/hvc1|hev1/.test(a)));
        this.videoBitsPerSecond = recordingBitrate(recordedSize.width, recordedSize.height, options);
      }

      this.file = await this.createFile();
      track.addEventListener("ended", () => this.stop(), { once: true });
      if (recordedTrack !== track) recordedTrack.addEventListener("ended", () => this.stop("Video processing ended unexpectedly."), { once: true });
      if (track.readyState === "ended") throw new Error("The tab is no longer sharing.");
      this.beginEncoder();
      this.publish("recording", { tabId, startedAt: Date.now(), settings: recordedTrack.getSettings() });
      if (options.maxDurationSeconds > 0) {
        this.autoStopTimer = setTimeout(() => this.stop(), options.maxDurationSeconds * 1000);
      }
      console.info("Page Recorder started:", { ...recordedTrack.getSettings(), mimeType: this.recorder.mimeType, targetFrameRate: this.frameRate, videoBitsPerSecond: this.videoBitsPerSecond });
    } catch (error) {
      this.releaseTracks();
      await this.discardFile();
      this.recorder = null;
      this.publish("error", { error: this.friendlyError(error) });
      throw new Error(this.status.error);
    }
  }

  beginEncoder() {
    let encoderError;
    while (this.nextEncoder < this.encoderCandidates.length) {
      const mimeType = this.encoderCandidates[this.nextEncoder++];
      try {
        const encoder = new this.MediaRecorderClass(this.stream, {
          videoBitsPerSecond: this.videoBitsPerSecond,
          mimeType,
          videoKeyFrameIntervalDuration: 1000,
        });
        if (encoder.mimeType && !/^video\/mp4(?:;|$)/i.test(encoder.mimeType)) throw new Error("This encoder did not select an MP4 container.");
        let failedBeforeData = false;
        encoder.addEventListener("dataavailable", event => {
          if (failedBeforeData || !event.data.size || this.writeError) return;
          this.bytesReceived += event.data.size;
          this.pendingWriteBytes += event.data.size;
          this.writeQueue = this.writeQueue
            .then(() => { if (!this.writeError) return this.file.write(event.data); })
            .catch(error => {
              this.writeError = error;
              this.stop();
            })
            .finally(() => { this.pendingWriteBytes -= event.data.size; });
          if (this.pendingWriteBytes > MAX_PENDING_WRITE_BYTES) {
            this.stop("The disk could not keep up. Recording stopped to avoid an unbounded memory backlog.");
          }
        });
        encoder.addEventListener("error", event => {
          this.recordingError = event.error || new Error("The video encoder stopped unexpectedly.");
          failedBeforeData = this.bytesReceived === 0 && this.nextEncoder < this.encoderCandidates.length;
          // An encoder may accept construction/start and fail asynchronously.
          // Preserve the live tab stream so the next codec can use it.
          if (failedBeforeData) {
            if (encoder.state !== "inactive") encoder.stop();
          } else {
            this.stop();
          }
        });
        encoder.addEventListener("stop", () => {
          if (failedBeforeData && this.bytesReceived === 0 && this.status.phase === "recording" && this.stream?.getVideoTracks()[0]?.readyState === "live") {
            try {
              this.beginEncoder();
              this.recordingError = null;
              return;
            } catch (error) {
              this.recordingError = error;
            }
          }
          this.finalizing ??= this.finish();
        }, { once: true });
        encoder.start(CHUNK_MS);
        this.recorder = encoder;
        this.requestVideoFrame?.();
        return;
      } catch (error) {
        encoderError = error;
      }
    }
    const size = this.stream?.getVideoTracks()[0]?.getSettings();
    throw new Error(`MP4 encoding is unavailable${size?.width ? ` at ${size.width} × ${size.height}` : ""}. Choose a lower Output quality. ${encoderError?.message || this.recordingError?.message || "No MP4 encoder is available."}`);
  }

  stop(reason) {
    if (this.status.phase !== "recording") return;
    if (typeof reason === "string") this.stopReason = reason;
    this.publish("saving");
    this.requestVideoFrame?.();
    if (this.recorder?.state !== "inactive") this.recorder.stop();
    // Stop capture promptly, including when Chrome's own Stop sharing was used.
    this.releaseTracks();
  }

  async finish() {
    this.publish("saving");
    this.releaseTracks();
    try {
      // MediaRecorder delivers its last dataavailable before the stop event.
      await this.writeQueue;
      if (this.writeError) throw this.writeError;
      const file = await this.file.finish();
      if (!file.size) throw this.recordingError || new Error("The recording was empty. Record the tab for a little longer.");
      const type = this.recorder.mimeType || "video/mp4";
      this.filename = recordingFilename(type, new Date(), this.filenamePrefix);
      this.savedBlob = file.slice(0, file.size, type);
      this.recorder = null;
      await this.save();
    } catch (error) {
      this.recorder = null;
      if (!this.savedBlob) await this.discardFile();
      this.publish("error", {
        error: this.friendlyError(error),
        retryAvailable: Boolean(this.savedBlob),
      });
    }
  }

  async retrySave() {
    if (!this.savedBlob || this.status.phase !== "error") return;
    this.publish("saving");
    try {
      await this.save();
    } catch (error) {
      this.publish("error", { error: this.friendlyError(error), retryAvailable: true });
    }
  }

  async save() {
    this.blobUrl ??= this.urls.createObjectURL(this.savedBlob);
    await this.download(this.blobUrl, this.filename);
    this.urls.revokeObjectURL(this.blobUrl);
    this.blobUrl = null;
    this.savedBlob = null;
    await this.discardFile();
    if (this.stopReason) {
      this.publish("error", { error: `${this.stopReason} The available video was saved to Downloads.` });
    } else if (this.recordingError) {
      this.publish("error", { error: "Recording ended early. The available video was saved to Downloads." });
    } else {
      this.publish("idle");
    }
  }

  releaseTracks() {
    clearTimeout(this.autoStopTimer);
    this.autoStopTimer = undefined;
    const release = this.releaseVideo;
    this.releaseVideo = null;
    this.requestVideoFrame = null;
    release?.();
    new Set([...(this.stream?.getTracks() || []), ...(this.sourceStream?.getTracks() || [])]).forEach(track => track.stop());
    this.stream = null;
    this.sourceStream = null;
    this.mobileCrop = null;
  }

  async discardFile() {
    if (!this.file) return;
    try {
      await this.file.discard();
    } catch (error) {
      console.warn("Could not remove the temporary recording:", error);
    }
    this.file = null;
  }

  friendlyError(error) {
    if (error?.name === "QuotaExceededError") return "Your disk is full. Free some space and try again.";
    if (["EncodingError", "NotSupportedError"].includes(error?.name)) return `MP4 encoding is unavailable at this resolution. Choose a lower Output quality. ${error.message}`;
    if (error?.name === "NotAllowedError") return "Chrome did not allow recording this tab. Open a regular webpage and try again.";
    return error?.message || "Recording failed. Try again.";
  }
}
