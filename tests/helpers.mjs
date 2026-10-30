import vm from "node:vm";
let moduleNumber = 0;
export const page = { id: 42, windowId: 9, url: "https://example.com/" };
export function mockChrome(preferences = {}) {
  preferences = structuredClone(preferences);
  const calls = [], actions = {}, events = {}, sessionStorage = {};
  const normal = { id: 9, width: 1120, height: 860, left: 100, top: 50, state: "normal", focused: true };
  const window = { ...normal };
  let attached = false;
  let documentFullscreen = false;
  const document = {
    fullscreenEnabled: true,
    get fullscreenElement() { return documentFullscreen ? this.documentElement : null; },
    documentElement: { requestFullscreen: async options => {
      documentFullscreen = true;
      calls.push({ type: "DOCUMENT_FULLSCREEN_ENTER", options });
    } },
    exitFullscreen: async () => { documentFullscreen = false; calls.push({ type: "DOCUMENT_FULLSCREEN_EXIT" }); },
  };
  const event = name => ({ addListener: listener => { events[name] = listener; } });
  const store = data => ({
    get: async keys => keys == null ? structuredClone(data) : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(data[key])])),
    set: async values => { Object.assign(data, structuredClone(values)); },
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  });
  globalThis.chrome = {
    runtime: { id: "test-extension", getURL: path => `chrome-extension://test-extension/${path}`,
      onMessage: event("message"), onInstalled: event("installed"), onStartup: event("startup") },
    debugger: {
      attach: async target => { if (attached) throw new Error("Another debugger is attached"); attached = true; calls.push({ type: "ATTACH", ...target }); },
      detach: async target => { attached = false; calls.push({ type: "DETACH", ...target }); },
      sendCommand: async (target, method, params) => {
        calls.push({ type: "DEBUG", ...target, method, params: structuredClone(params) });
        if (method === "Runtime.evaluate") {
          try {
            const value = await vm.runInNewContext(params.expression, { document, window: {
              innerWidth: documentFullscreen ? 1920 : window.width - (window.state === "fullscreen" ? 0 : 20),
              innerHeight: documentFullscreen ? 1080 : window.height - (window.state === "fullscreen" ? 0 : 100),
            } });
            return { result: { value: structuredClone(value) } };
          } catch (error) { return { exceptionDetails: { exception: { description: error.message } } }; }
        }
      },
      onDetach: event("debugDetached"), onEvent: event("debugEvent"),
    },
    action: { onClicked: event("click"), ...Object.fromEntries(["setIcon", "setTitle", "setBadgeText", "setBadgeBackgroundColor", "setBadgeTextColor"].map(name => [name, async value => { actions[name] = value; }])) },
    permissions: { contains: async () => true },
    commands: { onCommand: event("command"), getAll: async () => [
      { name: "scroll-down", shortcut: "⌃⌘Z" }, { name: "scroll-up", shortcut: "⌃⌘X" }, { name: "scroll-next-point", shortcut: "⌃Z" },
    ] },
    scripting: { executeScript: async options => { calls.push({ type: "SCRIPT", ...options }); return []; } },
    storage: { onChanged: event("storage"), session: store(sessionStorage), local: store(preferences) },
    windows: { get: async () => ({ ...window }), getLastFocused: async () => ({ ...window }), onBoundsChanged: event("boundsChanged"),
      update: async (windowId, changes) => {
        calls.push({ type: "WINDOW_UPDATE", windowId, changes: structuredClone(changes) });
        Object.assign(window, changes.state === "fullscreen" ? { width: 1920, height: 1080, left: 0, top: 0 } : normal, changes);
        return { ...window };
      } },
    tabs: { get: async tabId => ({ ...page, id: tabId }), query: async () => [page], onUpdated: event("tabUpdated"), onActivated: event("tabActivated"), onRemoved: event("tabRemoved") },
  };
  function activate(overrides = {}) {
    window.state = "fullscreen"; window.width = 1920; window.height = 1080;
    return sessionStorage.viewportSession = {
      ...page, tabId: page.id, origin: "https://example.com", sessionId: "one", phase: "active", mode: "desktop", settings: { width: 1280, height: 0 },
      restoreState: "normal", originalInsets: { width: 20, height: 100 }, fullscreenInsets: { width: 0, height: 0 },
      view: { width: 1280, height: 1080, scale: 1, visibleWidth: 1280, visibleHeight: 1080 }, ...overrides,
    };
  }
  const message = (message, sender = { id: "test-extension", url: "chrome-extension://test-extension/options.html" }) => new Promise((resolve, reject) => {
    const handled = events.message({ target: "background", ...message }, sender, resolve);
    if (handled !== true) resolve(undefined);
  });
  return { calls, actions, events, sessionStorage, preferences, window, document, activate, message, get attached() { return attached; }, detachExternally() { attached = false; } };
}
export async function setup(preferences) {
  const h = mockChrome(preferences);
  const background = await import(`../background.js?test=${moduleNumber++}`);
  return Object.assign(h, background);
}
