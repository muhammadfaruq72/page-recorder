# Page Recorder

A Chrome extension with one toolbar button. Click to record the current webpage; click again to stop and automatically save the video.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select this `page-recorder` folder (the folder containing `manifest.json`).
4. Open Chrome's extensions menu (the puzzle-piece icon) and **pin Page Recorder**.

No build step, account, or server is needed. Requires Chrome 116 or newer.

## Recording output settings

In **Options → Recording output**, use the single **Output quality** dropdown to choose **1×**, **2×**, or **3×** for both desktop and mobile videos. The scale multiplies the webpage viewport’s CSS width and height without changing its layout. The default is **3×**: a 390 × 844 mobile viewport exports at 1170 × 2532, and a 1280 × 720 desktop viewport exports at 3840 × 2160. Previous mobile-only scale choices are migrated to this shared setting.

The **Show cursor in recordings** switch applies to both modes. It defaults to **On**. Turn it **Off** to hide the page cursor during recording; the normal cursor is restored when recording stops or fails.

Choose a **Frame rate** of **15, 24, 25, 30, 50, or 60 FPS**. The default remains **60 FPS** for smooth scrolling. Lower frame rates reduce capture and rendering work. The target applies to source capture and output frame processing; actual frame rate depends on browser and hardware performance. The page’s scrolling animation duration stays the same at every frame rate.

Open **More recording settings** for these shared desktop and mobile controls:

| Setting | Choices | Default |
| --- | --- | --- |
| Video bitrate | Automatic, or a custom target of 1–200 Mbps | Automatic, based on output size and FPS |
| MP4 codec | Auto, H.264, or H.265 / HEVC | Auto |
| Start delay | 0–60 seconds | 0, start immediately |
| Auto-stop after | 0–86,400 seconds | 0, stop manually |
| Filename prefix | Up to 64 characters, excluding reserved filename characters | `recording` |

All recording output controls save automatically and apply when the next recording starts. Changing them during a recording leaves that recording’s captured settings in place. Existing saved scale and cursor choices are preserved when updating.

**Auto** codec selection can try another supported MP4 encoder if the first cannot start. Choosing **H.264** or **HEVC** requires that codec to be available at the selected resolution; the recorder reports a failure if it cannot use your choice. Every codec option exports MP4.

A start delay runs after the recording viewport is prepared. The toolbar badge shows the remaining seconds; click the same icon again to cancel the countdown. Auto-stop counts from the start of recording, excludes the countdown, and stops and saves through the usual download flow. You can still stop earlier with the toolbar button. The filename uses your prefix followed by a timestamp and `.mp4`, inside **Downloads → Page Recorder**. An empty prefix resets to `recording`.

The settings show an approximate storage rate based on the target bitrate. For automatic mobile bitrate, the estimate uses the configured viewport and scale. Automatic desktop bitrate shows a range because the final webpage viewport is measured when recording starts. Actual file size varies with page content and the encoder.

Exports in either mode can be at most **8,192 pixels per side**. If the chosen scale exceeds that limit, select a lower output quality or use a smaller viewport.

## Set the recording window width

Right-click the **Page Recorder** toolbar icon, choose **Options**, enter **Width** in pixels, and click **Save width**. The width stays saved across recordings, extension reloads, and browser restarts. Existing saved widths are preserved when updating from the previous version; saved heights are removed.

For desktop recordings, the extension finds the display containing most of the Chrome window, restores the window from fullscreen or maximized mode if needed, applies your saved width, and expands to the display's **full usable height**. It aligns the window with the top of that usable area and keeps it inside the display. The height excludes the taskbar, Dock, menu bar, and other desktop areas reserved by your system. Height is recalculated for each recording, including when you switch displays. The recorder waits for the webpage to resize before capturing, and the window stays at that size after stopping. Mobile mode skips these window changes entirely.

The width applies to the **whole Chrome window**, including its frame. The video contains the webpage inside it, so its dimensions differ from the window dimensions. Desktop video exports multiply the webpage viewport’s CSS width and height by the shared **Output quality** scale, independently of your display’s pixel density. For example, at 3× a 1280 × 720 webpage viewport exports at 3840 × 2160. The recording layout stays at its existing size. Exported desktop dimensions can be at most 8,192 pixels per side; choose a lower output quality or smaller window if the export would exceed that limit. If the saved width exceeds the usable display width, or your system cannot apply the size, recording does not start; hover over the **!** badge for the error and choose a smaller width in Options.

Before you have saved a width, the first recording remembers the current normal window's width, capped to fit the display. You can change it later in Options.

After updating an existing unpacked installation, click **Reload** on its card in `chrome://extensions` to load the new setting.

## Mobile mode

In **Options → Mobile mode**, turn on **Enable mobile mode**, enter the viewport width and height, and click **Save mobile settings**. The default is **390 × 844 CSS pixels**, with exactly the same aspect ratio as the reference video’s **1170 × 2532 pixels** (195:422). Mobile mode uses the shared **Output quality** dropdown in **Recording output**. At the default 3× scale, the webpage keeps its 390 × 844 layout and the video exports at 1170 × 2532. Each viewport dimension can be 100–4,096 pixels; exported dimensions in either mode can be at most 8,192 pixels per side. These settings apply when the next recording starts.

Click the usual toolbar button on the website you want to record. Mobile mode uses Chrome/Arc’s native viewport emulation on the **original tab**, so websites with `X-Frame-Options` or CSP `frame-ancestors` restrictions work without an iframe or a second page load. Form values and the page’s DOM remain intact. The browser window keeps its size and position. The mobile view scales to fit the available tab space while preserving the configured aspect ratio. The browser places the native preview at the upper-left of the tab; the remaining preview area is browser-controlled. The saved MP4 contains **only the mobile viewport**, at the viewport dimensions multiplied by the shared output scale, excluding the surrounding preview area.

Mobile mode requires the **debugger** extension permission. It attaches only to the tab selected by your toolbar click, applies viewport and touch emulation, and detaches when recording ends. It opens no Inspect/DevTools window. Chrome/Arc may display a debugging banner while it is connected. Close an existing Inspect/DevTools session before starting mobile mode. If you cancel debugging or the browser disconnects it, the recorder stops and saves the available video. Desktop recordings do not attach a debugger.

Both scrolling shortcuts work on the mobile viewport. With a height of 844 px, a 30% step scrolls about 253 px and the full viewport shortcut scrolls 844 px. Stopping restores the normal desktop viewport on the current page without resizing the browser window. Changing the mobile switch or dimensions during a recording applies to the next recording.

This is a responsive mobile viewport with touch input capabilities, rather than a simulation of a particular phone’s operating system; it retains the browser’s user agent. Same-origin navigation is supported. Navigating to another origin ends the active-tab permission used for keyboard handling, so the recorder stops and saves; start a new recording on that destination. Protected browser pages and protected video content remain subject to the browser’s capture restrictions.

## Saved scroll points

In **Options → Scroll points**, enable **Collect scroll points** and allow the optional website-access request. This permission lets the extension show a small **Save scroll point** button on HTTP/HTTPS webpages. Open your webpage, scroll manually to a position, and click the button. Repeat for each position you want to visit. The options page lists saved positions in pixels, grouped by page URL; **Clear all points** removes every saved position. Turning collection off keeps your list.

Start recording with the usual toolbar button. The collection button disappears before capture starts. Press **Command + Shift + 7** on Mac or **Ctrl + Shift + 7** on Windows/Linux to move to the next point, using your saved scrolling transition and duration. Customize this third shortcut with **Change shortcuts**; Arc uses the same page-key fallback as the existing shortcuts. No scrolling happens until you press a key. Each recording begins with the first point; additional presses queue points in collection order. After the final point, presses do nothing. The next-point shortcut works even when the percentage/full-viewport scrolling switch is off.

Points store the document/body’s vertical scroll offset, rather than positions inside nested scrolling panels. Positions are scoped to the full page URL excluding its fragment, so different pages keep separate lists. Capture them at the page layout you intend to record: responsive layouts, expanded content, and lazy loading can change where a pixel offset lands. A position beyond the current page bottom is clamped to the available height. Point lists are read on the first next-point press of each recording (and after navigating to another page).

Collection stays hidden while recording and saving, and returns afterward if its switch is still on. The original percentage and full-viewport shortcuts remain available. All points stay in local extension storage.

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
- If a start delay is configured, the badge counts down first. Click again during the countdown to cancel.
- The icon becomes a **stop square** with a red **REC** badge while recording.
- Click the same icon again to stop, or wait for your configured auto-stop duration. The video saves in **Downloads → Page Recorder** with your filename prefix and a timestamp.
- A gray **…** badge means starting or saving. Wait for it to clear before starting another recording.
- An amber **!** badge means something went wrong. Hover over the icon to read the error. If a download failed, click again to retry saving the retained video.

Recording stays on the original tab when you switch tabs and continues across navigation in that tab. Clicking the icon from any tab stops the active recording. Closing the recorded tab or using Chrome's **Stop sharing** control also stops and saves it. Only one recording runs at a time.

Desktop videos capture the visible webpage area, including scrolling and interactions, at the starting viewport dimensions multiplied by the shared output scale. The saved video dimensions stay fixed during that recording. Mobile videos capture only the mobile viewport at the selected output resolution. Cursor visibility follows the shared **Show cursor in recordings** switch in both modes. Browser toolbars, other applications, and offscreen parts of the page are excluded. Chrome internal pages, the Chrome Web Store, and other protected pages may reject capture. To record local `file://` pages, enable **Allow access to file URLs** in the extension's Chrome settings.

## Video quality and storage

Recordings are **video only**, with a **60 fps target** and **3× output by default in both modes**. Desktop and mobile exports both multiply their viewport dimensions by the same selected output scale, which defaults to three. The recorder requests a higher-resolution source in both modes and renders the page at the selected export scale. MP4 uses even-sized frames: odd output dimensions receive at most one black edge pixel of padding, without shrinking or stretching the page content. Mobile emulation also requests high-density page assets. Actual frame rate and source detail depend on the browser, GPU, and website assets; enlarging output dimensions cannot recover detail from a lower-resolution source.

At the default **60 FPS**, automatic bitrate starts at **30 Mbps** for a 1170 × 2532 mobile video and increases with larger export pixel counts, up to **120 Mbps**. Lower FPS reduces the automatic bitrate baseline proportionally; custom bitrate overrides this calculation. **All new recordings use an MP4 container.** With Auto codec, H.264 is preferred for common sizes; larger frames can use platform HEVC where supported. The recorder does not fall back to WebM, rename another container as MP4, or silently shrink the selected output scale. If the browser cannot encode MP4 at the chosen resolution, it reports the failure and suggests a lower Output quality. [Chrome’s MP4/HEVC support](https://developer.chrome.com/blog/chrome-136-beta#h26x_codec_support_updates_for_mediarecorder) depends on browser and platform capabilities.

Encoded video is delivered to a dedicated disk worker in approximately **one-second chunks**. The worker writes and explicitly flushes each chunk to an **origin-private disk file** before acknowledging it; disk I/O and chunk-to-byte conversion stay off the capture thread. Only bounded pending chunks stay in memory, rather than the whole recording. The finished MP4 appears in **Downloads → Page Recorder** after stopping. A sustained disk backlog stops and saves the available recording instead of growing memory without limit. A failed download retains the finished file for retry while the browser remains open.

The preferred frame-processing path consumes incoming capture frames with a one-frame queue, paces output to the selected FPS, retains only the latest picture for timing updates, and closes stale frames promptly. It does not repeatedly copy an unchanged full-resolution canvas at the full target FPS. A lightweight heartbeat preserves video timing on static pages. Browsers without that processing path use the existing video/canvas fallback at the selected FPS. The webpage’s scroll distance, easing, keyboard handling, and animation duration are unchanged.

**Stop and wait for the download before quitting Chrome, disabling, or reloading the extension.** Unfinished recordings are not automatically recovered after a browser shutdown. Temporary files left by a shutdown are removed when the recorder is next initialized.

Everything stays on your computer. There are no uploads, analytics, external dependencies, camera access, or microphone access. At the default 60 FPS with automatic bitrate, plan for roughly 225–900 MB per minute depending on resolution. Lower FPS can reduce this; custom bitrate allows a wider range. Finalizing a recording temporarily requires space for both the private file and the downloaded copy.

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
| `scripting` | Animate scrolling and apply the cursor visibility choice in the recorded tab. Uses the `activeTab` grant. |
| Optional HTTP/HTTPS website access | Show the scroll-point collection button when you enable collection. Requested separately; recording does not require it. |
| `debugger` | Apply native mobile viewport and touch emulation to the selected tab, then restore and detach on stop. Required by the browser for mobile mode. |

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

Run `npm run test:mobile` for mobile settings, exact viewport and exported video dimensions, responsive layout, native viewport fitting, cropping out surrounding space, mobile scrolling, same-origin navigation, cleanup, debugger detachment, and successful recording on websites that block embedding. It uses the same Playwright setup and a temporary browser profile.

To verify the actual OS keyboard shortcuts, run `npm run test:native`. It opens a temporary Chrome window and records a test page; press the percentage and full viewport shortcuts there when the terminal shows **READY**. Browser automation's synthetic page key events bypass Chrome's native extension shortcut dispatcher, so this check uses real keypresses separately from the automated browser tests.

Chrome API reference: [Tab capture and offscreen recording](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture#record-audio-and-video-in-the-background).
