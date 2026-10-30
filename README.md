# Page Viewport

One toolbar toggle for fullscreen desktop or mobile webpage viewports, plus scroll-point collection and smooth keyboard scrolling. Version 2 removes video recording and all recording settings. Version 2.0.1 handles delayed or ignored fullscreen window requests.

## Install or update

Open `chrome://extensions` (or `arc://extensions`), enable Developer mode, and use **Load unpacked** on this folder. For an existing installation, click **Reload** on its card after updating the files. Pin the toolbar icon. The extension is now named **Page Viewport**; its existing shortcut IDs and saved points are preserved.

The package command creates `dist/page-recorder.zip` for compatibility with the previous package name. Unzip it before loading. No dependencies, account, build step, or server are required. Chrome 116+ and compatible Chromium browsers are supported.

## Fullscreen viewport toggle

1. Open a regular webpage.
2. Click the toolbar button. The browser enters fullscreen and the original tab receives the selected desktop or mobile viewport, anchored at the upper-left. The badge shows **ON**.
3. Use the scrolling shortcuts or interact with the page normally.
4. Click the same button again, including from another tab, to remove emulation and exit fullscreen. A previously maximized window returns to maximized; other windows return to normal. No width, height, or position is assigned to the browser window.

If you manually exit fullscreen, close the active tab, cancel the debugging connection, or navigate to another website origin, viewport mode ends and page cleanup runs. Same-origin navigation is supported. Only one viewport session runs at a time. Browser service-worker suspension does not discard its state. Fullscreen entry waits for the window transition. If the browser ignores or rejects that request, the extension uses the page’s Fullscreen API. In that fallback, Escape or navigating away ends viewport mode; the browser’s reported window state is not used as proof that the page left fullscreen.

Both modes use the page's native render surface, with no iframe and no Inspect window. Sites that reject embedding continue to work. The configured CSS layout stays at its requested dimensions; the preview scales proportionally to fit the fullscreen area. Unused space remains to the right or below, with its appearance controlled by the browser.

## Dimensions

Right-click the toolbar icon and open **Options**.

- **Desktop viewport:** width defaults to 1280 CSS pixels, or your previously saved width. Height **0** uses the available fullscreen height. Set a fixed height if you want a particular aspect ratio. Dimensions can be 100–16,384 px (or height 0).
- **Mobile viewport:** enable Mobile mode and set width and height. Existing dimensions are preserved; the default is **390 × 844 CSS pixels**. Each dimension can be 100–4,096 px. Mobile mode enables touch emulation and retains the browser's user agent.

The mobile switch chooses the mode for the next activation. Dimension changes also apply on the next activation. The extension fits the entire configured viewport and keeps it aligned left in either mode. Desktop height 0 tracks the available fullscreen area.

Native emulation uses the `debugger` permission in both modes. Chrome/Arc may show a debugging banner. Close Inspect or another debugger on the selected tab before activating. Older Arc versions can retain the narrow page surface after disconnection; cleanup briefly reconnects to restore it and immediately detaches. If another debugger blocks cleanup, close it and click the toolbar button to retry. Protected browser pages and the Chrome Web Store cannot be controlled. Local files require **Allow access to file URLs** in extension settings.

## Scroll points

Enable **Collect scroll points** in Options and allow the optional HTTP/HTTPS website permission. A **Save scroll point** button appears on websites. Collect your positions before activating viewport mode. Switching on immediately removes any already-injected collection button before fullscreen starts. It stays hidden on the active viewport tab and returns after toggle-off, or a failed activation, if collection is still enabled. Saved points and scrolling shortcuts continue working while the button is hidden.

Scroll to each position and click **Save scroll point**. Positions are saved in collection order, grouped by the full page URL without its fragment. **Clear all points** removes all saved positions. Turning collection off removes the button and keeps your saved list.

With viewport mode on, press the **next saved scroll point** shortcut for each smooth move. A new activation starts at the first point. Additional presses queue separate moves; after the final point they do nothing. The next-point shortcut works independently of the percentage/full-height switch. It uses the same animation transition and duration. Positions are document/body scroll offsets; positions beyond the current bottom are clamped. Nested panels use the percentage/full-height shortcuts instead.

## Smooth scrolling

Enable **scroll shortcuts** for percentage and full-height steps. Both scroll down. Defaults remain **30%** of the emulated viewport height, **1.5 seconds**, and **Extra smooth** easing. Choose another easing, duration, or percentage in Options and save. Animation changes apply to subsequent presses, including within the active session. Turning the switch off cancels pending scrolling; turning viewport mode off cancels scrolling and removes the page shortcut listener.

| Action | Windows / Linux default | Mac default |
| --- | --- | --- |
| Down by saved percentage | Ctrl + Shift + 9 | Command + Shift + 9 |
| Down one full viewport height | Ctrl + Shift + 8 | Command + Shift + 8 |
| Next saved point | Ctrl + Shift + 7 | Command + Shift + 7 |

Existing key assignments are preserved. The internal second command ID remains `scroll-up` solely to retain its assigned shortcut; its action is down by a full viewport. Options displays the actual bindings. Use **Change shortcuts** to customize them.

Keep the browser in front. In Arc, use **In Arc** scope and focus the webpage. The existing page-key fallback handles Arc sessions that do not dispatch a native extension command. Duplicate delivery produces one movement; distinct rapid presses queue individual steps. Percentage/full-height scrolling supports large nested scrolling panels as well as the document.

## Permissions and privacy

| Permission | Purpose |
| --- | --- |
| `activeTab` | Control the page explicitly selected by the toolbar click. |
| `storage` | Save dimensions, scrolling settings, points and the active viewport session locally. |
| `scripting` | Install keyboard handling, animate scrolling and display point collection. |
| `debugger` | Apply and restore native page dimensions in both modes. |
| Optional HTTP/HTTPS access | Display the collection button when its setting is enabled. |

There is no video capture, encoding, download worker, offscreen document, cursor-hiding setting, FPS, bitrate, export scale, or recording timer. Capture, downloads, unlimited-storage, and system-display permissions have been removed. Everything stays on your computer, with no uploads or analytics.

## Development

```sh
npm test
npm run package
```

Tests run in Node with mocked Chrome APIs and animation clocks. They do not launch or control a browser. The package contains only the extension's runtime files, icons and this README.

Native API references: [Chrome window states](https://developer.chrome.com/docs/extensions/reference/api/windows), [Chrome DevTools emulation protocol](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/), [Fullscreen API](https://fullscreen.spec.whatwg.org/).
