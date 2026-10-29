import test from "node:test";
import assert from "node:assert/strict";
import { hideRecordingCursor, restoreRecordingCursor, recordingCursorStyle } from "../recording-cursor.js";

test("cursor hiding and restoration still reach the top page when another frame denies access", async () => {
  const inserted = [];
  const removed = [];
  const apply = calls => async options => {
    calls.push(options);
    if (options.target.allFrames) throw new Error("A cross-origin frame denied access");
  };
  globalThis.chrome = { scripting: { insertCSS: apply(inserted), removeCSS: apply(removed) } };
  await hideRecordingCursor(42, "one");
  await restoreRecordingCursor({ tabId: 42, cursorSessionId: "one" });
  assert.deepEqual(inserted.at(-1).target, { tabId: 42 });
  assert.deepEqual(removed.at(-1).target, { tabId: 42 });
  assert.equal(removed.at(-1).css, inserted.at(-1).css);
  assert.equal(removed.at(-1).origin, "USER");
  assert.notEqual(recordingCursorStyle("one"), recordingCursorStyle("two"));
});
