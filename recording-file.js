let directoryPromise;

async function recordingDirectory() {
  if (!directoryPromise) {
    directoryPromise = (async () => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle("page-recorder-temporary", { create: true });
      // Only runs once per document. Remove files left by a browser shutdown;
      // a live recording or retryable download is never removed here.
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
  const name = `${crypto.randomUUID()}.video`;
  const handle = await directory.getFileHandle(name, { create: true });
  let writer;
  try {
    writer = await handle.createWritable();
  } catch (error) {
    await directory.removeEntry(name).catch(() => {});
    throw error;
  }
  let closed = false;

  return {
    write: chunk => writer.write(chunk),
    async finish() {
      await writer.close();
      closed = true;
      return handle.getFile();
    },
    async discard() {
      if (!closed) await writer.abort().catch(() => {});
      await directory.removeEntry(name);
    },
  };
}
