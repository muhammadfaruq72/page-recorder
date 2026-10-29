export const FPS = 60;
export const BITRATE = 30_000_000;
export const CHUNK_MS = 5_000;
export const MIME_TYPES = [
  "video/mp4;codecs=avc1",
  "video/x-matroska;codecs=avc1",
  "video/webm;codecs=vp8",
  "video/webm",
];

export function videoExtension(mimeType = "") {
  if (mimeType.startsWith("video/mp4")) return "mp4";
  if (mimeType.startsWith("video/x-matroska")) return "mkv";
  return "webm";
}

export function recordingFilename(mimeType, date = new Date()) {
  return `Page Recorder/recording-${date.toISOString().replace(/[:.]/g, "-")}.${videoExtension(mimeType)}`;
}

export function captureSize({ width, height, devicePixelRatio = 1 } = {}, h264 = false) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return {};
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
    this.encoderCandidates = [];
    this.nextEncoder = 0;
    this.stopReason = null;
  }

  publish(phase, extra = {}) {
    this.status = { phase, ...extra };
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
    this.nextEncoder = 0;
    this.stopReason = null;

    try {
      const oddMobileSize = viewport.mobile && (viewport.mobile.width % 2 || viewport.mobile.height % 2);
      const mimeTypes = MIME_TYPES.filter(type => this.MediaRecorderClass.isTypeSupported(type) && !(oddMobileSize && type.includes("avc1")));
      this.encoderCandidates = [...mimeTypes, ""];
      const preferredType = mimeTypes[0] || "";
      this.stream = await this.getMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: streamId,
            ...captureSize(viewport, preferredType.includes("avc1")),
            maxFrameRate: FPS,
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
      const scale = preferredType.includes("avc1") && width && height
        ? Math.min(1, maxWidth / width, maxHeight / height)
        : 1;
      try {
        await track.applyConstraints({
          cursor: "never",
          frameRate: { ideal: FPS, max: FPS },
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
      const prepared = await this.prepareVideo(this.sourceStream, this.mobileCrop);
      this.releaseVideo = prepared.release;
      this.stream = prepared.stream;
      const recordedTrack = this.stream.getVideoTracks()[0];
      if (!recordedTrack || recordedTrack.readyState === "ended") throw new Error("The recording video is unavailable.");

      this.file = await this.createFile();
      track.addEventListener("ended", () => this.stop(), { once: true });
      if (track.readyState === "ended") throw new Error("The tab is no longer sharing.");
      this.beginEncoder();
      this.publish("recording", { tabId, startedAt: Date.now(), settings: recordedTrack.getSettings() });
      console.info("Page Recorder started:", { ...recordedTrack.getSettings(), mimeType: this.recorder.mimeType, videoBitsPerSecond: BITRATE });
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
          videoBitsPerSecond: BITRATE,
          ...(mimeType ? { mimeType } : {}),
        });
        let failedBeforeData = false;
        encoder.addEventListener("dataavailable", event => {
          if (!event.data.size || this.writeError) return;
          this.bytesReceived += event.data.size;
          this.writeQueue = this.writeQueue
            .then(() => this.file.write(event.data))
            .catch(error => {
              this.writeError = error;
              this.stop();
            });
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
        return;
      } catch (error) {
        encoderError = error;
      }
    }
    throw encoderError || this.recordingError || new Error("No video encoder is available.");
  }

  stop(reason) {
    if (this.status.phase !== "recording") return;
    if (typeof reason === "string") this.stopReason = reason;
    this.publish("saving");
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
      const type = this.recorder.mimeType || "video/webm";
      this.filename = recordingFilename(type);
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
    const release = this.releaseVideo;
    this.releaseVideo = null;
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
    if (error?.name === "NotAllowedError") return "Chrome did not allow recording this tab. Open a regular webpage and try again.";
    return error?.message || "Recording failed. Try again.";
  }
}
