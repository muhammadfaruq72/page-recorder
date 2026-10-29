// Dedicated disk I/O thread. Only individual encoded chunks are materialized
// here; neither the recorder nor the webpage holds the complete video in RAM.
let access;
let position = 0;
let lastFlush = 0;
let queue = Promise.resolve();

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      if (data.type === "INIT") {
        access = await data.handle.createSyncAccessHandle();
        access.truncate(0);
      } else if (data.type === "WRITE") {
        if (!access) throw new Error("The recording file is closed.");
        const bytes = new Uint8Array(await data.chunk.arrayBuffer());
        let offset = 0;
        while (offset < bytes.byteLength) {
          const written = access.write(bytes.subarray(offset), { at: position });
          if (written <= 0) throw new Error("The disk could not write the recording chunk.");
          offset += written;
          position += written;
        }
        // Keep file writes continuous while amortizing durable flushes. This
        // runs on the disk worker, never on the captured page or frame worker.
        if (performance.now() - lastFlush >= 5000) {
          access.flush();
          lastFlush = performance.now();
        }
      } else if (data.type === "FINISH") {
        if (!access) throw new Error("The recording file is closed.");
        await access.flush();
        await access.close();
        access = undefined;
      } else if (data.type === "ABORT") {
        if (access) await access.close();
        access = undefined;
      } else {
        throw new Error("Unknown recording file operation.");
      }
      self.postMessage({ id: data.id, ok: true });
    } catch (error) {
      self.postMessage({ id: data.id, ok: false, error: { name: error.name, message: error.message } });
    }
  });
};
