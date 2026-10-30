# Anemo Live Wallpaper v1.0.3

Version **1.0.3** addresses desktop visibility on Windows 11 (23H2/24H2), eliminates black screen loading overlays in desktop mode, and enforces strict zero-camera cold booting with minimized memory footprint.

---

## Downloads

| Package | Size | Description |
| :--- | :--- | :--- |
| **[`AnemoSetup.exe`](https://github.com/revolverocelot1/anemo-live-wallpaper/releases/download/v1.0.3/AnemoSetup.exe)** | **~120.9 MB** | **Recommended.** Single-file standalone installer. Installs to `%LocalAppData%\Programs\Anemo`, provisions Desktop & Start Menu shortcuts, and launches immediately. |
| **[`Anemo-Live-Wallpaper-Portable.zip`](https://github.com/revolverocelot1/anemo-live-wallpaper/releases/download/v1.0.3/Anemo-Live-Wallpaper-Portable.zip)** | **~120.8 MB** | **Portable Archive.** Extract to any folder and execute `Anemo.exe` directly without installation or registry writes. |

---

## What's Changed in v1.0.3

- **Windows 11 (23H2 / 24H2) Desktop Attachment Fix**:
  - Located the `WorkerW` child directly inside `Progman` on Windows 11 23H2/24H2 before falling back to top-level window enumeration.
  - Fixes an issue where the wallpaper was previously parented behind `SHELLDLL_DefView`, remaining hidden under Windows' default desktop icons.
  - Eliminated the `!Native.IsWindowVisible(Handle)` check in `MaintainAttachment()`, resolving an endless 1-second re-attachment loop that caused desktop instability.

- **Zero-Occlusion Desktop Rendering (Black Screen Fix)**:
  - Fixed a CSS collision in the web engine where utility classes enforced with `!important` overrode inline display rules, causing the dark intro transition container to permanently cover the screen.
  - Disabled the intro loading screen completely in desktop host mode (`?desktop=1`), ensuring immediate, zero-latency desktop wallpaper playback upon startup.
  - Added an automatic fade-out and unmount safety timer for web view.

- **Strict Cold-Boot Mouse Mode & Minimal RAM Overhead**:
  - Enforced mouse tracking mode on cold boot at all times, completely ignoring persisted camera modes from previous sessions on startup.
  - Hardware camera remains strictly closed and 0% active; MediaPipe vision models are not loaded into memory until the user explicitly toggles Person or Gaze mode from the tray.

---

# Anemo Live Wallpaper v1.0.2

Version **1.0.2** brings critical stability fixes for multi-monitor setups, fullscreen game transitions, and Explorer redraw resilience.

---

## Downloads (v1.0.2)

| Package | Size | Description |
| :--- | :--- | :--- |
| **[`AnemoSetup.exe`](https://github.com/revolverocelot1/anemo-live-wallpaper/releases/download/v1.0.2/AnemoSetup.exe)** | **~126.6 MB** | Single-file standalone installer. |
| **[`Anemo-Live-Wallpaper-Portable.zip`](https://github.com/revolverocelot1/anemo-live-wallpaper/releases/download/v1.0.2/Anemo-Live-Wallpaper-Portable.zip)** | **~126.5 MB** | Portable Archive. |

---

## What's Changed in v1.0.2

- **Multi-Monitor Stability:** Working on another monitor no longer triggers false desktop-covered sleep. The wallpaper runs continuously and fluidly across your display setup.
- **Fullscreen Return & Wake Resume:** Returning to desktop after a fullscreen game or screen lock immediately resumes 60 FPS video playback and cursor tracking.
- **Camera State Integrity:** When waking from sleep:
  - If **Mouse mode** is active (default), the camera remains strictly closed with zero hardware sensor activation.
  - If **Person or Gaze mode** is active, the webcam stream and MediaPipe pipeline are automatically re-acquired with reset tracking anchors.
- **Self-Healing Desktop Watchdog:** Implemented a continuous health monitor that verifies the `WorkerW` / `Progman` hierarchy every second and restores Z-order if Windows Explorer refreshes the desktop.
- **Win32 Window Styling:** Applied `WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN` to prevent desktop redraws from painting over the wallpaper surface.
- **D3D11 Video Surface Preservation:** Background video element avoids evicting swapchain buffers during power transitions.

---

## Attribution
- **Visual Artwork:** Edited artwork originally created by **[@aruhshura](https://x.com/aruhshura)**, featured in the video *["don't think about it anymore"](https://www.youtube.com/watch?v=A09aumNef-c)*.
- **Music & Sound:** Sourced and looped from *["don't think about it anymore"](https://www.youtube.com/watch?v=A09aumNef-c)*.
