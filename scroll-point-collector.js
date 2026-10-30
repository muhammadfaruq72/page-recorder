// Optional website access is requested only when collection is enabled.
(() => {
  const key = "__pageRecorderPointCollector";
  try { globalThis[key]?.remove(); } catch { /* Previous extension context was reloaded. */ }
  let host;
  let button;
  let removed = false;
  let revision = 0;
  function remove() {
    removed = true;
    revision++;
    host?.remove();
    chrome.storage.onChanged.removeListener(changed);
    window.removeEventListener("pagehide", remove);
    if (globalThis[key]?.remove === remove) delete globalThis[key];
  }
  async function refresh() {
    const current = ++revision;
    try {
      const [local, state] = await Promise.all([
        chrome.storage.local.get("collectScrollPoints"),
        chrome.runtime.sendMessage({ target: "background", type: "POINT_COLLECTION_STATE" }),
      ]);
      if (removed || current !== revision) return;
      if (!local.collectScrollPoints || state?.suspended) {
        host?.remove(); host = undefined; return;
      }
      if (host?.isConnected) return;
      host = document.createElement("div");
      host.style.cssText = "all:initial!important;position:fixed!important;right:20px!important;bottom:20px!important;z-index:2147483647!important;display:block!important";
      const shadow = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = "button{all:initial;display:block;font:600 13px/1.4 system-ui;background:#dc2630;color:white;border:1px solid #fff5;border-radius:12px;padding:13px 18px;box-shadow:0 4px 24px #0004;cursor:pointer}button:focus-visible{outline:3px solid #fff;outline-offset:3px}button:disabled{opacity:.7}";
      button = document.createElement("button");
      button.type = "button";
      button.textContent = "Save scroll point";
      button.addEventListener("click", async event => {
        event.stopPropagation();
        button.disabled = true;
        try {
          const top = Math.round((document.scrollingElement || document.documentElement).scrollTop);
          const result = await chrome.runtime.sendMessage({ target: "background", type: "COLLECT_POINT", top });
          if (!result?.ok) throw new Error(result?.error || "Could not save point");
          button.textContent = `Saved #${result.count} · ${top} px`;
        } catch (error) { button.textContent = error.message; }
        finally { button.disabled = false; }
      });
      shadow.append(style, button);
      document.documentElement.append(host);
    } catch { remove(); }
  }
  function changed(changes, area) {
    if (area === "local" && changes.collectScrollPoints) void refresh();
  }
  globalThis[key] = { remove };
  chrome.storage.onChanged.addListener(changed);
  window.addEventListener("pagehide", remove, { once: true });
  void refresh();
})();
