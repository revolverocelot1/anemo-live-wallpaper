# Anemo Live Wallpaper v1.0.2

Version **1.0.2** brings critical stability fixes for multi-monitor setups, fullscreen game transitions, and Explorer redraw resilience.

---

## Downloads

| Package | Size | Description |
| :--- | :--- | :--- |
| **[`AnemoSetup.exe`](https://github.com/revolverocelot1/anemo-live-wallpaper/releases/download/v1.0.2/AnemoSetup.exe)** | **~126.6 MB** | **Recommended.** Single-file standalone installer. Installs to `%LocalAppData%\Programs\Anemo`, provisions Desktop & Start Menu shortcuts, and launches immediately. |
| **[`Anemo-Live-Wallpaper-Portable.zip`](https://github.com/revolverocelot1/anemo-live-wallpaper/releases/download/v1.0.2/Anemo-Live-Wallpaper-Portable.zip)** | **~126.5 MB** | **Portable Archive.** Extract to any folder and execute `Anemo.exe` directly without installation or registry writes. |

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
