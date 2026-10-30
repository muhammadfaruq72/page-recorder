const controls = document.querySelector("#controls");
const fullscreen = document.querySelector("#fullscreen");
const mobile = document.querySelector("#mobile");
const collection = document.querySelector("#collection");
const clear = document.querySelector("#clear-points");
const status = document.querySelector("#status");
let tabId, state, busy = false, revision = 0;
function showStatus(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
async function send(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ target: "background", type, tabId, ...data });
  if (!response?.ok) throw new Error(response?.error || "Page Viewport did not respond. Reload the extension.");
  return response.state;
}
function render(next) {
  state = next;
  controls.disabled = busy || next.busy;
  fullscreen.checked = next.fullscreen;
  fullscreen.disabled = !next.fullscreen && !next.supported;
  mobile.checked = next.mobile;
  collection.checked = next.collectionEnabled;
  clear.disabled = !next.supported || !next.count;
  document.querySelector("#viewport-size").textContent = next.active ? `${next.width} × ${next.height} CSS px` : "Use saved dimensions";
  document.querySelector("#point-count").textContent = `${next.count} saved ${next.count === 1 ? "point" : "points"}`;
  document.querySelector("#page-url").textContent = next.url ? `Clear affects this page only: ${next.url}` : "Open a regular webpage to use fullscreen.";
}
async function refresh() {
  const current = ++revision;
  try { const next = await send("POPUP_STATE"); if (current === revision) render(next); }
  catch (error) { if (current === revision) showStatus(error.message, true); }
}
async function change(type, data, success, requestPermission = false) {
  if (busy || !state) return;
  busy = true;
  ++revision;
  render(state);
  try {
    // Call from the switch's user gesture, before any message or storage await.
    if (requestPermission && !await chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] })) throw new Error("Website access is required to show the page buttons.");
    const next = await send(type, data);
    ++revision;
    render(next);
    showStatus(success);
  } catch (error) { showStatus(error.message, true); await refresh(); }
  finally { busy = false; if (state) render(state); }
}
fullscreen.addEventListener("change", () => {
  const enabled = fullscreen.checked;
  void change("SET_FULLSCREEN", { enabled }, enabled ? "Fullscreen viewport is on." : "Fullscreen viewport is off.");
});
mobile.addEventListener("change", () => {
  const enabled = mobile.checked;
  void change("SET_MODE", { enabled }, enabled ? "Mobile mode selected." : "Desktop mode selected.");
});
collection.addEventListener("change", () => {
  const enabled = collection.checked;
  void change("SET_COLLECTION", { enabled }, enabled ? "Page buttons are on." : "Page buttons are off.", enabled);
});
clear.addEventListener("click", () => { void change("CLEAR_PAGE_POINTS", {}, "This page’s scroll points were cleared."); });
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.openOptionsPage().catch(error => showStatus(error.message, true)));
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === "session" && changes.viewportSession) || (area === "local" && (changes.collectScrollPoints || changes.scrollPoints || changes.mobileViewportSettings))) void refresh();
});
async function initialize() {
  try { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); tabId = tab?.id; await refresh(); if (state) showStatus("Saved dimensions and shortcuts are in Settings."); }
  catch (error) { showStatus(error.message, true); }
}
void initialize();
