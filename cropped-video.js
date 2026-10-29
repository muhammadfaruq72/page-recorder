import { DEFAULT_OUTPUT_SETTINGS } from "./settings.js";

// Map CSS coordinates into captured pixels, including capture-driver letterbox.
export function sourceCropRect(region, videoWidth, videoHeight) {
  if (!region || ![region.left, region.top, region.width, region.height, region.viewportWidth, region.viewportHeight, videoWidth, videoHeight].every(Number.isFinite)
    || Math.min(region.width, region.height, region.viewportWidth, region.viewportHeight, videoWidth, videoHeight) <= 0) {
    throw new Error("The capture area is unavailable.");
  }
  const scale = Math.min(videoWidth / region.viewportWidth, videoHeight / region.viewportHeight);
  return {
    x: (videoWidth - region.viewportWidth * scale) / 2 + region.left * scale,
    y: (videoHeight - region.viewportHeight * scale) / 2 + region.top * scale,
    width: region.width * scale,
    height: region.height * scale,
  };
}

export async function prepareRecordingVideo(source, mobile, viewport = {}, onError) {
  if (!mobile && !viewport.outputWidth) return { stream: source };
  const output = mobile || viewport;
  const frameRate = viewport.frameRate || DEFAULT_OUTPUT_SETTINGS.frameRate;
  const frameInterval = 1000 / frameRate;
  const contentWidth = output.contentWidth || output.outputWidth || output.width;
  const contentHeight = output.contentHeight || output.outputHeight || output.height;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((output.outputWidth || output.width) / 2) * 2;
  canvas.height = Math.ceil((output.outputHeight || output.height) / 2) * 2;
  const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!context) throw new Error("The browser could not allocate this recording resolution. Use a smaller recording window.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  // Content retains its exact scale. Any extra MP4 alignment edge stays black.
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);

  let stream;
  let outputTrack;
  let manualFrames = false;
  let reader;
  let processorTrack;
  let lastFrame;
  let nativeActive = false;
  let nativeStarted = false;
  let released = false;
  let video;
  let fallbackPromise;
  let fallbackTimer;
  let heartbeat;
  let lastSubmission = 0;
  let nextNativeFrameTime;

  function submitFrame() {
    if (released || outputTrack?.readyState !== "live") return;
    if (manualFrames) outputTrack.requestFrame();
    lastSubmission = performance.now();
  }
  function draw(image, width, height) {
    if (released || outputTrack?.readyState !== "live" || !width || !height) return;
    const region = mobile ? mobile.region : {
      left: 0, top: 0, width: viewport.width, height: viewport.height,
      viewportWidth: viewport.width, viewportHeight: viewport.height,
    };
    const crop = sourceCropRect(region, width, height);
    submitFrame();
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, contentWidth, contentHeight);
  }
  function refreshFrame() {
    if (lastFrame) draw(lastFrame, lastFrame.displayWidth || lastFrame.codedWidth, lastFrame.displayHeight || lastFrame.codedHeight);
    else if (video?.videoWidth) draw(video, video.videoWidth, video.videoHeight);
  }
  function stopProcessor() {
    nativeActive = false;
    const oldReader = reader;
    reader = undefined;
    oldReader?.cancel().catch(() => {});
    processorTrack?.stop();
    processorTrack = undefined;
    lastFrame?.close();
    lastFrame = undefined;
  }
  function release() {
    if (released) return;
    released = true;
    clearInterval(fallbackTimer);
    clearInterval(heartbeat);
    stopProcessor();
    if (video) { video.pause(); video.srcObject = null; }
    stream?.getTracks().forEach(track => track.stop());
    // Release the potentially large GPU canvas once encoding has stopped.
    canvas.width = canvas.height = 1;
  }

  async function startVideoFallback() {
    if (fallbackPromise) return fallbackPromise;
    fallbackPromise = (async () => {
      stopProcessor();
      video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = source;
      await video.play();
      if (released) { video.pause(); video.srcObject = null; return; }
      if (!video.videoWidth) await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("The recording video did not become ready.")), 10000);
        video.addEventListener("loadeddata", () => { clearTimeout(timeout); resolve(); }, { once: true });
      });
      if (released) return;
      draw(video, video.videoWidth, video.videoHeight);
      let lastDecoded = video.getVideoPlaybackQuality?.().totalVideoFrames || 0;
      let lastMediaTime = video.currentTime;
      // Preserve the proven offscreen timer fallback, but skip expensive canvas
      // copies when the decoder reports that it has no new frame to draw.
      fallbackTimer = setInterval(() => {
        if (released || !video.videoWidth) return;
        const decoded = video.getVideoPlaybackQuality?.().totalVideoFrames || 0;
        if (decoded > 0 && decoded === lastDecoded && video.currentTime === lastMediaTime) return;
        lastDecoded = decoded;
        lastMediaTime = video.currentTime;
        draw(video, video.videoWidth, video.videoHeight);
      }, frameInterval);
    })();
    return fallbackPromise;
  }

  function processingFailed(error) {
    if (released) return;
    onError?.(new Error(`Video processing ended unexpectedly. ${error.message}`));
    if (!released) outputTrack.stop();
  }

  async function startFrameProcessor() {
    const sourceTrack = source.getVideoTracks()[0];
    if (typeof MediaStreamTrackProcessor !== "function" || typeof sourceTrack.clone !== "function") return false;
    let readyResolve;
    let readyReject;
    let timer;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    try {
      // Isolate processor cancellation from the original capture, which is also
      // used by the fallback and the recorder's tab-closed handling.
      processorTrack = sourceTrack.clone();
      const processor = new MediaStreamTrackProcessor({ track: processorTrack, maxBufferSize: 1 });
      reader = processor.readable.getReader();
      const inputReader = reader;
      nativeActive = true;
      void (async () => {
        try {
          while (!released && nativeActive) {
            const { value: frame, done } = await inputReader.read();
            if (done) throw new Error("The captured video frame stream ended.");
            try {
              if (released || !nativeActive) continue;
              const timestamp = Number.isFinite(frame.timestamp) ? frame.timestamp / 1000 : performance.now();
              if (nextNativeFrameTime == null || timestamp < nextNativeFrameTime - frameInterval * 4) nextNativeFrameTime = timestamp;
              if (timestamp + 0.5 < nextNativeFrameTime) continue;
              nextNativeFrameTime += Math.max(1, Math.floor((timestamp - nextNativeFrameTime + 0.5) / frameInterval) + 1) * frameInterval;
              const cached = frame.clone();
              lastFrame?.close();
              lastFrame = cached;
              draw(frame, frame.displayWidth || frame.codedWidth, frame.displayHeight || frame.codedHeight);
              readyResolve();
            } finally { frame.close(); }
          }
        } catch (error) {
          const wasActive = nativeActive;
          nativeActive = false;
          readyReject(error);
          if (nativeStarted && wasActive && !released) {
            startVideoFallback().catch(processingFailed);
          }
        }
      })();
      await Promise.race([
        ready,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Frame processing is unavailable.")), 1500); }),
      ]);
      nativeStarted = true;
      return nativeActive;
    } catch {
      stopProcessor();
      return false;
    } finally { clearTimeout(timer); }
  }

  try {
    // MP4 hardware encoders need a positive nominal frame rate. A manual-only
    // captureStream(0) advertises zero FPS and can fail encoder configuration.
    // The canvas still submits only changed frames and the static heartbeat.
    stream = canvas.captureStream(frameRate);
    outputTrack = stream.getVideoTracks()[0];
    manualFrames = typeof outputTrack.requestFrame === "function";
    if (!manualFrames) {
      stream.getTracks().forEach(track => track.stop());
      stream = canvas.captureStream(frameRate);
      outputTrack = stream.getVideoTracks()[0];
    }
    if (!await startFrameProcessor()) await startVideoFallback();
    // Maintain timestamps on static pages without redrawing a large canvas
    // at the full target FPS. Scrolling draws follow incoming capture frames.
    if (manualFrames) heartbeat = setInterval(() => {
      if (released || performance.now() - lastSubmission < 100) return;
      // Painting is required by canvas capture even for an unchanged picture.
      refreshFrame();
    }, 100);
    return { stream, release, requestFrame: refreshFrame };
  } catch (error) {
    release();
    throw error;
  }
}
