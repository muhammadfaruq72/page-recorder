# Page Viewport

Fullscreen desktop or mobile webpage viewports, scroll-point collection and smooth keyboard scrolling. Click the extension icon to open the four controls. Version 2.1 adds the popup and website controls; video recording remains removed.

## Install or update

Open `chrome://extensions` (or `arc://extensions`), enable Developer mode, and use **Load unpacked** on this folder. For an existing installation, click **Reload** on its card after updating the files. Pin the toolbar icon. The extension is now named **Page Viewport**; its existing shortcut IDs and saved points are preserved.

The package command creates `dist/page-recorder.zip` for compatibility with the previous package name. Unzip it before loading. No dependencies, account, build step, or server are required. Chrome 116+ and compatible Chromium browsers are supported.

## Extension popup and fullscreen

1. Open a regular webpage.
2. Click the extension icon to open its popup. It contains **Fullscreen view**, **Mobile mode**, **Collect scroll points**, and **Clear points**. The first three are switches; Clear points is a one-click action for the current page.
3. Turn on **Fullscreen view**. The browser enters fullscreen, with the original tab at the saved dimensions and aligned left. The badge shows **ON**. Use the scrolling shortcuts or interact with the page normally.
4. Reopen the popup and turn **Fullscreen view** off, including from another tab, to remove emulation and exit fullscreen. A previously maximized window returns to maximized; other windows return to normal. No width, height, or position is assigned to the browser window.

If you manually exit fullscreen, close the active tab, cancel the debugging connection, or navigate to another website origin, viewport mode ends and page cleanup runs. Same-origin navigation is supported. Only one viewport session runs at a time. When one is active, the popup controls that session and shows its page URL. Browser service-worker suspension does not discard its state. Fullscreen entry waits for the window transition. If the browser ignores or rejects that request, the extension uses the page’s Fullscreen API. In that fallback, Escape or navigating away ends viewport mode; the browser’s reported window state is not used as proof that the page left fullscreen.

Both modes use the page's native render surface, with no iframe and no Inspect window. Sites that reject embedding continue to work. The configured CSS layout stays at its requested dimensions. Both modes scale the preview to fill the entire available fullscreen height and derive its width from the saved aspect ratio. If the result is wider than the screen, the right edge is clipped instead of reducing the height. The webpage controls stay inside the visible part. Unused space remains to the right or below, with its appearance controlled by the browser.

## Dimensions

Right-click the toolbar icon and open **Options**.

- **Desktop viewport:** default **1080 × 1215 CSS pixels (8:9)**. Width and height define the layout and aspect ratio, just like mobile. Each dimension can be 100–16,384 px. **Use default · 1080 × 1215** restores and saves the default pair. Older automatic-height settings keep their saved width and receive a reference height derived from 8:9 within the allowed size range; existing positive dimensions are preserved.
- **Mobile viewport:** enable Mobile mode and set width and height. Existing dimensions are preserved; the default is **390 × 844 CSS pixels**. Each dimension can be 100–4,096 px. Mobile mode enables touch emulation and retains the browser's user agent.

The popup’s **Mobile mode** switch changes the active fullscreen viewport immediately without exiting fullscreen or reloading the page. With fullscreen off, it selects the mode for the next activation. The website mode button does the same. Switching modes cancels pending scrolling and restarts point playback at the first saved point. Dimension edits in Options apply on the next activation or when switching into that mode. Both previews fill the available fullscreen height, with one uniform scale factor for width and height, and stay aligned left. For example, a 1080 × 1215 desktop layout shown at 900 px high has a projected width of 800 px. Physical surface sizes are rounded to whole pixels without stretching the page; an over-wide preview is clipped at the browser’s right edge.

Native emulation uses the `debugger` permission in both modes. Chrome/Arc may show a debugging banner. Close Inspect or another debugger on the selected tab before activating. Older Arc versions can retain the narrow page surface after disconnection; cleanup briefly reconnects to restore it and immediately detaches. If another debugger blocks cleanup, close it and use the popup’s Fullscreen view switch to retry. Protected browser pages and the Chrome Web Store cannot be controlled. Local files require **Allow access to file URLs** in extension settings.

## Scroll points

Enable **Collect scroll points** in the popup or Options and allow the optional HTTP/HTTPS website permission. A compact panel appears on the webpage with **Save scroll point**, **Clear points**, and a **desktop/mobile** button. It stays visible while collection is on, including in fullscreen and mobile view. Turning collection off removes the panel without deleting points.

Collect using the layout you plan to scroll. Save records the document’s current vertical position in collection order, grouped by URL without its fragment. The page’s Clear points button and popup Clear points action remove positions for that page only and stop its pending scrolling. **Clear all points** in Options still removes every saved list. The mode button switches an active viewport immediately, or selects the next fullscreen mode when inactive. A button on another tab cannot change the active viewport’s mode.

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
| Optional HTTP/HTTPS access | Display the website controls when collection is enabled. |

There is no video capture, encoding, download worker, offscreen document, cursor-hiding setting, FPS, bitrate, export scale, or recording timer. Capture, downloads, unlimited-storage, and system-display permissions have been removed. Everything stays on your computer, with no uploads or analytics.

## Development

```sh
npm test
npm run package
```

Tests run in Node with mocked Chrome APIs and animation clocks. They do not launch or control a browser. The package contains only the extension's runtime files, icons and this README.

Native API references: [Chrome window states](https://developer.chrome.com/docs/extensions/reference/api/windows), [Chrome DevTools emulation protocol](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/), [Fullscreen API](https://fullscreen.spec.whatwg.org/).
