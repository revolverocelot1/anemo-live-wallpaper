# Anemo Live Wallpaper v1.0.0

Initial public release of **Anemo Live Wallpaper** — an interactive 2.5D desktop environment and gaze-reactive wallpaper engine.

---

## Downloads

| Package | Size | Description |
| :--- | :--- | :--- |
| **[`AnemoSetup.exe`](https://github.com/revolverocelot1/anemo-live-wallpaper/releases/download/v1.0.0/AnemoSetup.exe)** | **~126.6 MB** | **Recommended.** Single-file standalone installer. Installs to `%LocalAppData%\Programs\Anemo`, provisions Desktop & Start Menu shortcuts, and launches immediately. |
| **[`Anemo-Live-Wallpaper-Portable.zip`](https://github.com/revolverocelot1/anemo-live-wallpaper/releases/download/v1.0.0/Anemo-Live-Wallpaper-Portable.zip)** | **~126.5 MB** | **Portable Archive.** Extract to any folder and execute `Anemo.exe` directly without installation or registry writes. |

---

## Architectural Highlights

- **Hardware Video Acceleration:** Direct3D11 / NVDEC / QSV decoding decoupled from WebGL foreground shaders, delivering zero-copy video playback without bus bandwidth saturation.
- **Resource Footprint:** Average runtime utilization under **26 MB JS heap** and **< 0.3% CPU**.
- **2.5D Gaze Dynamics:**
  - Real-time cursor gaze tracking with calibrated One-Euro 2D temporal filtering.
  - Procedural eyelid follow dynamics across five response profiles (`Off`, `Subtle 30%`, `Natural 56%`, `Dynamic 75%`, `Maximum 100%`).
  - Stylistic iris selections: Classic (Set 1 Default) and Focused (Set 2).
- **Multi-Monitor Orchestration:** Target Display 1, Display 2, or replicate across all monitors. Secondary displays automatically mute duplicate audio streams.
- **Windows Desktop Shell Hook:** Direct injection into the Windows `WorkerW` / `Progman` desktop window tree behind desktop icons.
- **Acoustic Horizon:** Seamless ambient soundtrack derived from *don't think about it anymore* with randomized start offset.

---

## Attribution
- **Visual Artwork:** Edited artwork originally created by **[@aruhshura](https://x.com/aruhshura)**, featured in the video *["don't think about it anymore"](https://www.youtube.com/watch?v=A09aumNef-c)*.
- **Music & Sound:** Sourced and looped from *["don't think about it anymore"](https://www.youtube.com/watch?v=A09aumNef-c)*.
