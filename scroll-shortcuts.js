// Installed only in the active viewport tab's isolated world. Arc can deliver a key
// to the page without firing chrome.commands.onCommand.
export function scrollShortcuts(config) {
  const key = "__pageRecorderShortcuts";
  globalThis[key]?.remove();
  if (config.action === "remove") return;

  function parse(shortcut) {
    const parts = shortcut.replace(/⌃/g, "Control+").replace(/⌘/g, "Command+")
      .replace(/⇧/g, "Shift+").replace(/⌥/g, "Alt+").split("+").map(part => part.trim().toLowerCase());
    const binding = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    for (const part of parts) {
      if (["ctrl", "control", "macctrl"].includes(part)) binding.ctrlKey = true;
      else if (["cmd", "command", "meta"].includes(part)) binding.metaKey = true;
      else if (["alt", "option"].includes(part)) binding.altKey = true;
      else if (part === "shift") binding.shiftKey = true;
      else if (part) binding.key = part;
    }
    return binding;
  }
  const bindings = config.commands.filter(command => command.shortcut && ["scroll-down", "scroll-up", "scroll-next-point"].includes(command.name))
    .map(command => ({ command: command.name, ...parse(command.shortcut) }));
  function matches(event, binding) {
    if (["ctrlKey", "metaKey", "altKey", "shiftKey"].some(modifier => event[modifier] !== binding[modifier])) return false;
    const named = { up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright", space: " ", comma: ",", period: "." };
    const wanted = named[binding.key] || binding.key;
    // Shift changes a digit's event.key (e.g. Shift+9 is '(' on US keyboards).
    return wanted && (event.key.toLowerCase() === wanted || (/^\d$/.test(wanted) && event.code === `Digit${wanted}`));
  }
  function remove() {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("fullscreenchange", onFullscreenChange, true);
    window.removeEventListener("pagehide", remove);
    if (globalThis[key]?.remove === remove) delete globalThis[key];
  }
  function onFullscreenChange() {
    if (document.fullscreenElement) return;
    chrome.runtime.sendMessage({ target: "background", type: "VIEWPORT_FULLSCREEN_EXIT", sessionId: config.sessionId }).catch(remove);
  }
  function onKey(event) {
    if (!event.isTrusted || event.repeat || event.isComposing || !document.hasFocus()) return;
    const binding = bindings.find(binding => matches(event, binding));
    if (!binding) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    chrome.runtime.sendMessage({
      target: "background", type: "SCROLL_KEY", command: binding.command, sessionId: config.sessionId,
    }).catch(remove); // Reloading the extension invalidates the old isolated world.
  }
  globalThis[key] = { sessionId: config.sessionId, remove };
  window.addEventListener("keydown", onKey, true);
  if (config.documentFullscreen) {
    window.addEventListener("fullscreenchange", onFullscreenChange, true);
    onFullscreenChange();
  }
  window.addEventListener("pagehide", remove, { once: true });
}
