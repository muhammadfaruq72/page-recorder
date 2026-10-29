// Map CSS coordinates into the captured video, accounting for any letterbox
// added by the capture driver when the browser window changes size.
export function sourceCropRect(region, videoWidth, videoHeight) {
  if (!region || ![region.left, region.top, region.width, region.height, region.viewportWidth, region.viewportHeight, videoWidth, videoHeight].every(Number.isFinite)
    || Math.min(region.width, region.height, region.viewportWidth, region.viewportHeight, videoWidth, videoHeight) <= 0) {
    throw new Error("The mobile capture area is unavailable.");
  }
  const scale = Math.min(videoWidth / region.viewportWidth, videoHeight / region.viewportHeight);
  return {
    x: (videoWidth - region.viewportWidth * scale) / 2 + region.left * scale,
    y: (videoHeight - region.viewportHeight * scale) / 2 + region.top * scale,
    width: region.width * scale,
    height: region.height * scale,
  };
}

export async function prepareRecordingVideo(source, mobile) {
  if (!mobile) return { stream: source };
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  canvas.width = mobile.width;
  canvas.height = mobile.height;
  const context = canvas.getContext("2d", { alpha: false });
  video.muted = true;
  video.playsInline = true;
  video.srcObject = source;
  let timer;
  let stream;
  const release = () => {
    clearInterval(timer);
    video.pause();
    video.srcObject = null;
    stream?.getTracks().forEach(track => track.stop());
  };
  try {
    await video.play();
    if (!video.videoWidth) await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("The mobile video did not become ready.")), 10000);
      video.addEventListener("loadeddata", () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
    const draw = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      const crop = sourceCropRect(mobile.region, video.videoWidth, video.videoHeight);
      context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    };
    draw();
    stream = canvas.captureStream(60);
    // Offscreen documents do not reliably receive animation-frame callbacks.
    timer = setInterval(draw, 1000 / 60);
    return { stream, release };
  } catch (error) {
    release();
    throw error;
  }
}
