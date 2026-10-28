# Anemo Live Wallpaper v1.0.0 — Initial Release

Welcome to the initial release of **Anemo Live Wallpaper**!

An interactive, responsive 2.5D desktop live wallpaper featuring fluid hardware-accelerated background motion, natural 2.5D eye gaze and eyelid tracking, and multi-monitor support.

---

## 📦 Downloads

| Package | Size | Description |
| :--- | :--- | :--- |
| **[`AnemoSetup.exe`](https://github.com/your-username/anemo-live-wallpaper/releases/download/v1.0.0/AnemoSetup.exe)** | **~126.6 MB** | **Recommended.** Single-file installer. One click installs to `%LocalAppData%\Programs\Anemo`, adds Desktop & Start Menu shortcuts, and launches instantly. |
| **[`Anemo-Live-Wallpaper-Portable.zip`](https://github.com/your-username/anemo-live-wallpaper/releases/download/v1.0.0/Anemo-Live-Wallpaper-Portable.zip)** | **~126.5 MB** | **Portable Archive.** Extract anywhere and run `Anemo.exe` directly without installation. |

---

## ✨ Features in this Release

- **Fluid Hardware Video Acceleration:** Direct3D11 / NVDEC / QSV decoding behind a transparent WebGL canvas. Zero-copy texture streaming with 0% video stutter.
- **Ultra-Low Resource Footprint:** Under **0.3% CPU** and **~26 MB JS Heap RAM** on average.
- **2.5D Dynamic Eye Rig & Eyelid Dynamics:**
  - Real-time cursor gaze tracking with smooth One-Euro 2D temporal filtering.
  - Multi-level Eyelid Follow slider (`Off`, `Subtle 30%`, `Natural 56% Default`, `Dynamic 75%`, `Max 100%`).
  - Dual Iris Styles: Classic (Set 1 Default) and Focused (Set 2).
- **Multi-Monitor Duplicate & Selection:** Run on Display 1, Display 2, or duplicated seamlessly across all monitors with automatic audio isolation on secondary displays.
- **Optional MediaPipe Webcam Tracking:** Person room tracking & high-precision face tracking with automatic calibration wizard.
- **Windows System Tray & Boot Integration:** Toggle auto-start on Windows startup, change monitors, switch eyelid dynamics, and control volume from the tray icon.
- **Ambient Looping Soundtrack:** Sourced from *"don't think about it anymore"* with randomized entry point. Off by default.

---

## 🎨 Attribution
- **Visual Artwork:** Edited artwork of **[@aruhshura](https://x.com/aruhshura)** from *["don't think about it anymore"](https://www.youtube.com/watch?v=A09aumNef-c)*.
- **Ambient Music:** Sourced and looped from *["don't think about it anymore"](https://www.youtube.com/watch?v=A09aumNef-c)*.
