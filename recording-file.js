let directoryPromise;

async function recordingDirectory() {
  if (!directoryPromise) {
    directoryPromise = (async () => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle("page-recorder-temporary", { create: true });
      // Only runs once per offscreen document. Live recordings and retryable
      // downloads are kept until their owner explicitly discards them.
      for await (const name of directory.keys()) await directory.removeEntry(name);
      return directory;
    })().catch(error => {
      directoryPromise = undefined;
      throw error;
    });
  }
  return directoryPromise;
}

export async function createRecordingFile() {
  const directory = await recordingDirectory();
  const name = `${crypto.randomUUID()}.mp4`;
  const handle = await directory.getFileHandle(name, { create: true });
  const pending = new Map();
  let worker;
  let sequence = 0;
  let closed = false;
  let failure;

  function fail(error) {
    failure ||= error;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(failure);
    }
    pending.clear();
    worker?.terminate();
  }
  function request(type, data = {}) {
    if (failure) return Promise.reject(failure);
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error("The recording disk writer stopped responding.")), 20000);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, type, ...data }); }
      catch (error) { fail(error); }
    });
  }
  try {
    worker = new Worker(new URL("./recording-file-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      const operation = pending.get(data.id);
      if (!operation) return;
      pending.delete(data.id);
      clearTimeout(operation.timer);
      if (data.ok) operation.resolve();
      else {
        const error = new Error(data.error?.message || "The recording could not be written to disk.");
        error.name = data.error?.name || "Error";
        operation.reject(error);
      }
    };
    worker.onerror = event => {
      event.preventDefault();
      fail(new Error(event.message || "The recording disk worker stopped."));
    };
    worker.onmessageerror = () => fail(new Error("The recording disk worker could not receive its data."));
    await request("INIT", { handle });
  } catch (error) {
    worker?.terminate();
    await directory.removeEntry(name).catch(() => {});
    throw error;
  }

  return {
    write: chunk => request("WRITE", { chunk }),
    async finish() {
      await request("FINISH");
      closed = true;
      worker.terminate();
      return handle.getFile();
    },
    async discard() {
      try {
        if (!closed && !failure) await request("ABORT").catch(() => {});
      } finally {
        closed = true;
        worker.terminate();
      }
      await directory.removeEntry(name);
    },
  };
}
