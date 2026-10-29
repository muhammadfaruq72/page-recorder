# Page Recorder

A Chrome extension with one toolbar button. Click to record the current webpage; click again to stop and automatically save the video.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select this `page-recorder` folder (the folder containing `manifest.json`).
4. Open Chrome's extensions menu (the puzzle-piece icon) and **pin Page Recorder**.

No build step, account, or server is needed. Requires Chrome 116 or newer.

## Set the recording window width

Right-click the **Page Recorder** toolbar icon, choose **Options**, enter **Width** in pixels, and click **Save width**. The width stays saved across recordings, extension reloads, and browser restarts. Existing saved widths are preserved when updating from the previous version; saved heights are removed.

For desktop recordings, the extension finds the display containing most of the Chrome window, restores the window from fullscreen or maximized mode if needed, applies your saved width, and expands to the display's **full usable height**. It aligns the window with the top of that usable area and keeps it inside the display. The height excludes the taskbar, Dock, menu bar, and other desktop areas reserved by your system. Height is recalculated for each recording, including when you switch displays. The recorder waits for the webpage to resize before capturing, and the window stays at that size after stopping. Mobile mode skips these window changes entirely.

The width applies to the **whole Chrome window**, including its frame. The video contains the webpage inside it, so its dimensions differ from the window dimensions and can also reflect your display's pixel density. If the saved width exceeds the usable display width, or your system cannot apply the size, recording does not start; hover over the **!** badge for the error and choose a smaller width in Options.

Before you have saved a width, the first recording remembers the current normal window's width, capped to fit the display. You can change it later in Options.

After updating an existing unpacked installation, click **Reload** on its card in `chrome://extensions` to load the new setting.

## Mobile mode

In **Options → Mobile mode**, turn on **Enable mobile mode**, enter the viewport width and height, and click **Save mobile dimensions**. The default is **390 × 844 CSS pixels**, which has exactly the same aspect ratio as the reference video’s **1170 × 2532 pixels** (195:422). Each dimension can be 100–4,096 pixels. These settings apply when the next recording starts.

Click the usual toolbar button on the website you want to record. A fresh copy of that website opens in a responsive viewport centered inside the same tab, with black space around its preview. The browser window keeps its exact size and position, including fullscreen or maximized state. The preview scales up or down to use the largest area that fits the available tab, preserving its aspect ratio without stretching; its internal layout dimensions remain the values you entered. The saved video contains **only the mobile viewport**, at exactly the configured width and height: a 390 × 844 viewport produces a 390 × 844 video with no surrounding black space. The crop follows changes in the available tab size. No Inspect/DevTools window, debugger permission, or extra extension permission is needed.

Both scrolling shortcuts work inside the mobile viewport. For a height of 844 px, a 30% step scrolls about 253 px and the full viewport shortcut scrolls 844 px. Stopping recording removes the mobile preview and reveals the original page at its previous scroll position. Changing the mobile switch or dimensions during a recording applies to the next recording.

This is a responsive viewport, so it uses the website's layout for that width. It keeps the desktop browser's user agent and input capabilities; it does not simulate a particular phone's operating system. The website must allow embedding within its own origin. Websites that prohibit embedded views show an error before capture starts. Same-origin navigation inside the preview is supported; navigating to another origin or leaving the preview stops and saves the recording. Open that destination directly to start a new recording there.

## Smooth scrolling with keyboard shortcuts

The **Smooth scrolling** section in **Options** controls scrolling. Turn on **Enable scroll shortcuts**; the main switch takes effect immediately. Set the animation transition, duration, and scroll distance, then click **Save scrolling settings**. Saved animation settings apply to the next shortcut press, including during an existing recording.

| Setting | Default |
| --- | --- |
| Main switch | Off |
| Animation transition | Extra smooth, with a gentle start and finish |
| Animation duration | 1.5 seconds per step |
| Scroll distance | 30% of the visible webpage height per press |

Start recording and keep your browser in front. The shortcuts always control the recorded tab. Press a shortcut once for each step:

| Scroll down distance | Windows / Linux | Mac |
| --- | --- | --- |
| Saved percentage (30% by default) | Ctrl + Shift + 9 | Command + Shift + 9 |
| One full viewport height (100%) | Ctrl + Shift + 8 | Command + Shift + 8 |

Both shortcuts scroll down using the saved animation transition and duration. The first uses your configured percentage; the second always moves one full visible webpage height, regardless of that percentage. Existing shortcut assignments are preserved when updating. Each press queues one complete animated step. Rapid presses run in order with no overlapping animations. Steps stop at the bottom of the page. Large scrolling panels inside applications are supported as well as ordinary webpages. Turning off the switch or stopping recording cancels the current animation and clears queued steps. The recording continues until you stop it with the toolbar button.

The defaults avoid Chrome's built-in shortcuts. OS customizations and other extensions can have their own bindings, so **Options** displays the actual assigned keys. Click **Change shortcuts**, or open `chrome://extensions/shortcuts`, to reassign them. Unassigned shortcuts are shown as **Not assigned**.

### Arc shortcut support

In Arc, open `arc://extensions/shortcuts`, assign your keys (for example **Control + Command + Z**), and use **In Arc** scope. Start recording, then click the webpage to give it keyboard focus. The extension also listens for the assigned shortcut inside the recorded page, covering Arc sessions where the browser saves the binding without delivering a native extension command. Each press still produces only one step if both routes fire. The page listener is removed when recording stops or the scrolling switch is disabled, and reattached after supported navigation. Changing a key takes effect on the next recording or when you return to the recorded tab.

## Record

- Open the webpage to record, then click the **red circle** in Chrome's toolbar.
- The icon becomes a **stop square** with a red **REC** badge while recording.
- Click the same icon again to stop. The video saves in **Downloads → Page Recorder** with a timestamped filename.
- A gray **…** badge means starting or saving. Wait for it to clear before starting another recording.
- An amber **!** badge means something went wrong. Hover over the icon to read the error. If a download failed, click again to retry saving the retained video.

Recording stays on the original tab when you switch tabs and continues across navigation in that tab. Clicking the icon from any tab stops the active recording. Closing the recorded tab or using Chrome's **Stop sharing** control also stops and saves it. Only one recording runs at a time.

Desktop videos capture the visible webpage area, including scrolling and interactions. Mobile videos capture only the mobile viewport at its saved dimensions. Recordings hide the mouse cursor in both modes; the webpage's normal cursor is restored when recording stops. Browser toolbars, other applications, and offscreen parts of the page are excluded. Chrome internal pages, the Chrome Web Store, and other protected pages may reject capture. To record local `file://` pages, enable **Allow access to file URLs** in the extension's Chrome settings.

## Video quality and storage

Based on the supplied recorder script: **video only**, **60 fps target**, and **30 Mbps target bitrate**. Actual frame rate, bitrate, and desktop resolution depend on the page, display, hardware, and Chrome's encoder. Mobile videos use the exact configured output dimensions. H.264/MP4 is preferred, followed by H.264/MKV and WebM according to browser support. Odd mobile dimensions use a compatible WebM encoder to preserve the exact size. Desktop H.264 capture is scaled to fit within 4096 × 2304 (or 2304 × 4096 in portrait).

Video chunks are written to Chrome's private on-disk storage every five seconds rather than keeping the entire video in memory. Stopping finalizes the video, downloads it, then removes the temporary file. A failed download keeps the finished video available for retry while Chrome remains open. **Stop and wait for the download before quitting Chrome, disabling, or reloading the extension.** Unfinished recordings are not recovered after a browser shutdown. Temporary files left by a shutdown are removed when the recorder is next initialized.

Everything stays on your computer. There are no uploads, analytics, external dependencies, camera access, or microphone access. At the requested bitrate, plan for approximately 225 MB per minute; finalizing a recording temporarily requires space for both the private file and the downloaded copy.

## Permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` | Access the tab explicitly selected by your toolbar click. |
| `tabCapture` | Capture that tab's video without a screen-selection dialog. |
| `offscreen` | Keep recording across navigation and service-worker suspension. |
| `downloads` | Save the finished recording and check that it completed. |
| `unlimitedStorage` | Stream longer recordings to private disk storage without the normal web-storage quota. Available disk space still applies. |
| `storage` | Remember your recording window's width and scrolling preferences locally. |
| `system.display` | Read the current display's usable height and position the window within it. |
| `scripting` | Animate scrolling in the recorded tab when you press its shortcuts. Uses the existing `activeTab` grant. |

## Development

The extension uses Manifest V3 and native browser APIs. Edit the files, then click **Reload** on its card in `chrome://extensions`.

```sh
npm test
npm run package
```

The package command creates `dist/page-recorder.zip` containing only the files needed to install the extension and this README. Unzip it before using **Load unpacked**.

The optional browser smoke test uses Playwright and a recent Chromium build with the DevTools `Extensions.triggerAction` command:

```sh
npm install --no-save playwright
npx playwright install chromium
npm run test:browser
```

It exercises saving the window width, automatically filling the usable display height before each recording, scrolling settings, injected animation, queued steps, cancellation, real tab capture, navigation, stop, download, and video playback in a temporary browser profile. Set `HEADED=1` to see its browser window. The extension itself requires none of these development dependencies.

Run `npm run test:mobile` for mobile settings, exact viewport and exported video dimensions, responsive layout, centering, cropping out black space, cursor hiding, mobile scrolling, same-origin navigation, cleanup, and websites that block embedding. It uses the same Playwright setup and a temporary browser profile.

To verify the actual OS keyboard shortcuts, run `npm run test:native`. It opens a temporary Chrome window and records a test page; press the percentage and full viewport shortcuts there when the terminal shows **READY**. Browser automation's synthetic page key events bypass Chrome's native extension shortcut dispatcher, so this check uses real keypresses separately from the automated browser tests.

Chrome API reference: [Tab capture and offscreen recording](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture#record-audio-and-video-in-the-background).
