import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { scrollShortcuts } from "../scroll-shortcuts.js";

function setup(shortcut = "⌃⌘Z") {
  const listeners = new Map();
  const messages = [];
  const context = vm.createContext({
    window: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
    },
    document: { hasFocus: () => true },
    chrome: { runtime: { sendMessage: async message => { messages.push(structuredClone(message)); return { ok: true }; } } },
  });
  const run = config => vm.runInContext(`(${scrollShortcuts.toString()})(${JSON.stringify(config)})`, context);
  run({ action: "install", sessionId: "one", commands: [{ name: "scroll-down", shortcut }] });
  const press = (changes = {}) => {
    const event = { key: "z", code: "KeyZ", isTrusted: true, ctrlKey: true, metaKey: true, altKey: false, shiftKey: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...changes };
    listeners.get("keydown")?.(event);
    return event;
  };
  return { listeners, messages, context, run, press };
}

test("Arc's Control+Command+Z glyph shortcut sends one authenticated page message", () => {
  const h = setup();
  assert.equal(h.press().prevented, true);
  assert.deepEqual(h.messages, [{ target: "background", type: "SCROLL_KEY", command: "scroll-down", sessionId: "one" }]);
});

test("shortcut modifiers are exact; repeats, synthetic events, and background pages are ignored", () => {
  const h = setup();
  for (const changes of [{ ctrlKey: false }, { shiftKey: true }, { isTrusted: false }, { repeat: true }, { isComposing: true }]) {
    assert.equal(h.press(changes).prevented, undefined);
  }
  h.context.document.hasFocus = () => false;
  h.press();
  assert.equal(h.messages.length, 0);
});

test("shifted digit shortcuts work despite the resulting punctuation key", () => {
  const h = setup("Command+Shift+9");
  h.press({ key: "(", code: "Digit9", ctrlKey: false, shiftKey: true });
  assert.equal(h.messages.length, 1);
});

test("reinstallation replaces the old binding and removal restores page keyboard handling", () => {
  const h = setup();
  h.run({ action: "install", sessionId: "two", commands: [{ name: "scroll-up", shortcut: "Control+Command+X" }] });
  h.press();
  h.press({ key: "x" });
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].command, "scroll-up");
  assert.equal(h.messages[0].sessionId, "two");
  h.run({ action: "remove" });
  h.press({ key: "x" });
  assert.equal(h.messages.length, 1);
  assert.equal(h.listeners.size, 0);
});

test("page-fullscreen exit is reported and the fullscreen listener is removed on cleanup", () => {
  const h = setup();
  h.context.document.fullscreenElement = {};
  h.run({ action: "install", sessionId: "full", commands: [], documentFullscreen: true });
  assert.equal(h.messages.length, 0);
  h.context.document.fullscreenElement = null;
  h.listeners.get("fullscreenchange")();
  assert.deepEqual(h.messages, [{ target: "background", type: "VIEWPORT_FULLSCREEN_EXIT", sessionId: "full" }]);
  h.run({ action: "remove" });
  assert.equal(h.listeners.size, 0);
});
