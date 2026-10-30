// Isolated, removable website controls. Only enabled by the collection switch.
(() => {
  const key = "__pageRecorderPointCollector";
  try { globalThis[key]?.remove(); } catch { /* An older extension context expired. */ }
  let host, save, clear, mode, status, state;
  let removed = false, revision = 0, busy = false;
  function remove() {
    removed = true;
    revision++;
    host?.remove();
    chrome.storage.onChanged.removeListener(changed);
    window.removeEventListener("pagehide", remove);
    if (globalThis[key]?.remove === remove) delete globalThis[key];
  }
  async function message(type, data = {}) {
    const result = await chrome.runtime.sendMessage({ target: "background", type, ...data });
    if (!result?.ok) throw new Error(result?.error || "Page Viewport did not respond.");
    return result;
  }
  function render() {
    if (!host) return;
    const inset = state.controlsRightInset || 0;
    host.style.setProperty("right", `${12 + inset}px`, "important");
    host.style.setProperty("max-width", `calc(100vw - ${24 + inset}px)`, "important");
    save.disabled = busy || state.busy;
    clear.disabled = busy || state.busy || !state.count;
    mode.disabled = busy || state.busy || state.otherActive;
    const next = state.mobile ? "desktop" : "mobile";
    mode.textContent = state.active ? `Switch to ${next}` : `Use ${next} next`;
    mode.title = state.otherActive ? "Viewport mode is active in another tab." : state.active ? "Change this viewport immediately" : "Choose the mode for the next fullscreen activation";
  }
  async function perform(type, data, success) {
    if (busy || removed) return;
    busy = true;
    render();
    try {
      const result = await message(type, data);
      if (!removed) { status.textContent = typeof success === "function" ? success(result) : success; status.dataset.error = "false"; await refresh(); }
    } catch (error) { if (!removed) { status.textContent = error.message; status.dataset.error = "true"; } }
    finally { busy = false; if (!removed) render(); }
  }
  async function refresh() {
    const current = ++revision;
    try {
      const response = await message("PAGE_CONTROL_STATE");
      if (removed || current !== revision) return;
      state = response.state;
      if (!state.collectionEnabled) { host?.remove(); host = undefined; return; }
      if (host?.isConnected) { render(); return; }
      host = document.createElement("div");
      host.style.cssText = "all:initial!important;position:fixed!important;right:12px!important;bottom:12px!important;z-index:2147483647!important;display:block!important;max-width:calc(100vw - 24px)!important";
      const shadow = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = ":host{color-scheme:dark}.panel{box-sizing:border-box;display:grid;gap:7px;width:170px;max-width:100%;padding:10px;border:1px solid #ffffff30;border-radius:13px;background:#151922;box-shadow:0 4px 24px #0005}button{all:initial;display:block;box-sizing:border-box;text-align:center;font:600 12px/1.4 system-ui;background:#2b3342;color:white;border-radius:7px;padding:9px 10px;cursor:pointer}button.save{background:#dc2630}button:hover{filter:brightness(1.15)}button:focus-visible{outline:2px solid white;outline-offset:2px}button:disabled{opacity:.5;cursor:default}.status{font:11px/1.4 system-ui;color:#addec2;overflow-wrap:anywhere}.status:empty{display:none}.status[data-error=true]{color:#ffa49c}";
      const panel = document.createElement("div"); panel.className = "panel";
      save = document.createElement("button"); save.type = "button"; save.className = "save"; save.textContent = "Save scroll point";
      clear = document.createElement("button"); clear.type = "button"; clear.textContent = "Clear points"; clear.title = "Clear this page’s points";
      mode = document.createElement("button"); mode.type = "button";
      status = document.createElement("span"); status.className = "status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      save.addEventListener("click", event => { event.stopPropagation(); void perform("COLLECT_POINT", { top: Math.round((document.scrollingElement || document.documentElement).scrollTop) }, result => `Saved #${result.count} · ${result.top} px`); });
      clear.addEventListener("click", event => { event.stopPropagation(); void perform("PAGE_CLEAR_POINTS", {}, "This page’s points cleared."); });
      mode.addEventListener("click", event => { event.stopPropagation(); void perform("PAGE_SET_MODE", { enabled: !state.mobile }, state.active ? "Viewport mode changed." : "Mode selected for fullscreen."); });
      panel.append(save, clear, mode, status); shadow.append(style, panel); document.documentElement.append(host);
      render();
    } catch { remove(); }
  }
  function changed(changes, area) {
    if (area === "local" && (changes.collectScrollPoints || changes.scrollPoints || changes.mobileViewportSettings)) void refresh();
  }
  globalThis[key] = { remove, refresh };
  chrome.storage.onChanged.addListener(changed);
  window.addEventListener("pagehide", remove, { once: true });
  void refresh();
})();
