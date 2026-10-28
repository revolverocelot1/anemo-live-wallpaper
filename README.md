<div align="center">

# Anemo — The Living 2.5D Interactive Wallpaper

**A responsive, zero-compromise living wallpaper engine for Windows & Web.**  
Features fluid hardware-accelerated video playback, dynamic 2.5D eye gaze tracking, natural eyelid deformation, multi-monitor duplicate support, and an ultra-low memory footprint.

[![Release](https://img.shields.io/badge/Release-v1.0.0-blue.svg?style=flat-square)](./releases/RELEASE_NOTES.md)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Web-555555.svg?style=flat-square)](#quick-start)
[![Resolution](https://img.shields.io/badge/Resolution-2K%20Native%20(4K%20Planned)-6366f1.svg?style=flat-square)](#-resolution-roadmap-2k--4k)
[![RAM Usage](https://img.shields.io/badge/RAM-~26MB%20Heap-success.svg?style=flat-square)](#-performance-benchmarks)
[![CPU Usage](https://img.shields.io/badge/CPU-%3C0.3%25-success.svg?style=flat-square)](#-performance-benchmarks)
[![License](https://img.shields.io/badge/License-MIT%20Attributed-orange.svg?style=flat-square)](./LICENSE)

---

### 🎥 Watch in Action

![Anemo Live Wallpaper Preview](./demo/demo_preview.gif)

*Desktop recording showing real-time cursor eye tracking behind Windows desktop icons.*  
*(Full high-definition video available in [`demo/demo.mp4`](./demo/demo.mp4) or see original capture `Recording 2026-10-28 000013.mp4`)*

---

</div>

## 🌟 Overview

**Anemo** turns your desktop into an immersive living space. Unlike traditional video wallpapers that loop statically, Anemo brings the character to life with responsive 2.5D gaze tracking, dynamic eyelid morphing, and atmospheric wind motion—all while maintaining the resource footprint of a lightweight utility.

Whether you run it natively on your Windows desktop behind your desktop icons or host it on the web, Anemo delivers 60 FPS fluidity without taxing your GPU or draining your laptop battery.

---

## ✨ Key Features

* **⚡ Zero-Copy Hardware Acceleration:**  
  Background video (`bg_loop.mp4`) decodes directly through the GPU's native Direct3D11 / NVDEC / QSV hardware video engine. WebGL renders only the alpha-masked 2.5D eye sockets on top. Zero uncompressed video uploads per frame (`0%` GPU bus bottleneck).
* **👁️ 2.5D Dynamic Eye Rig & Eyelid Morphing:**  
  * Real-time cursor following with smooth One-Euro 2D temporal filtering.
  * Natural Eyelid Follow slider (`Off`, `Subtle 30%`, `Natural 56% Default`, `Dynamic 75%`, `Max 100%`).
  * Dual Iris Styles: **Classic (Set 1 Default)** and **Focused (Set 2)**.
* **🖥️ Multi-Monitor Support & Duplicate Mode:**  
  * Choose between Display 1, Display 2, or seamless **Duplicate on All Displays**.
  * Audio decoding is automatically isolated to the primary display to prevent sound echoing or redundant CPU cycles.
* **🪟 True Windows Desktop Integration:**  
  * Mounts directly behind Windows desktop icons using the native `WorkerW` / `Progman` desktop window tree.
  * System tray controls for quick monitor swapping, eyelid dynamics, audio toggles, and auto-start on Windows boot.
* **🎯 Optional MediaPipe Room & Gaze Tracking:**  
  * Webcam-powered person tracking and high-precision face tracking with an interactive calibration wizard.
  * Defaults strictly to mouse cursor mode (webcam is OFF by default).
* **🎵 Looping Ambient Soundscape:**  
  * Atmospheric ambient music sourced from *"don't think about it anymore"*.
  * Starts at a randomized offset each time it is enabled and loops seamlessly. Disabled by default.

---

## 📊 Performance Benchmarks

| Metric | Previous Build | Anemo v1.0.0 | Improvement |
| :--- | :--- | :--- | :--- |
| **JS Heap RAM** | ~650 MB | **~26 MB** | **96% Reduction** |
| **CPU Usage** | 3.5% – 4.1% | **< 0.3%** | **~92% Reduction** |
| **Texture Uploads** | 882 MB/sec (60 FPS `texImage2D`) | **0 MB/sec** (Hardware Overlay) | **100% Zero-Copy** |
| **Dual Monitor Lag** | High stutter / doubled memory | **Silky Smooth 60 FPS** | **Eliminated** |

---

## 📦 Quick Start

### 1. Windows Desktop (Recommended)

1. Head to the **[Releases](./releases/RELEASE_NOTES.md)** section.
2. Download **`AnemoSetup.exe`** (~126 MB).
3. Run the installer. It will:
   * Install the app to `%LocalAppData%\Programs\Anemo`.
   * Create Desktop & Start Menu shortcuts with the official logo.
   * Launch `Anemo.exe` immediately in your system tray.
4. *(Optional)* Alternatively, download **`Anemo-Live-Wallpaper-Portable.zip`**, extract anywhere, and double-click `Anemo.exe`.

### 2. Run on the Web / Self-Host

The web engine is fully standalone and can be run locally or deployed to any static host (Vercel, Netlify, Cloudflare Pages, Docker):

```bash
# Clone the repository
git clone https://github.com/your-username/anemo-live-wallpaper.git
cd anemo-live-wallpaper/web-engine

# Install dependencies and start Vite
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🎨 Asset Portability & Wallpaper Engine

Want to use these assets in **Steam Wallpaper Engine**, **Lively Wallpaper**, or your own custom creative coding project?

All raw, segmented assets are available in the [`assets-raw/`](./assets-raw) directory:
* `bg_loop.mp4` — High-definition 2K animated background video.
* `face_anchor.png` — Isolated character face layer with transparent eye sockets.
* `pupil_mask.png`, `eyes_open.png`, and `iris_v1.png`–`iris_v6.png` — Calibrated 2.5D eye deformation textures.
* `bgm.mp3` — Mastered ambient soundscape.

> **Note for creators:** You are completely free to adapt, animate, and port these assets to Steam Wallpaper Engine or any other wallpaper platform! All we ask is that you keep the artist attribution intact.

---

## 🗺️ Resolution Roadmap: 2K & 4K

* **Why 2K?** The current build runs natively at **2K (2560×1440)** because the original source artwork and animation render were created at that resolution.
* **4K Ultra-HD Planned:** We are actively planning a native 4K release featuring:
  * Enhanced high-resolution background video loop.
  * Ultra-crisp vector-fitted eyelid contours.
  * Additional character presets and dynamic background themes.

Contributions toward the 4K enhancement and new scene presets are warmly welcomed!

---

## 🤝 Community & Contributing

We welcome contributions from developers, animators, and enthusiasts:
* **Shader & Engine Optimization:** Enhancements to WebGL shaders, Direct3D rendering, or power-saving states.
* **Platform Ports:** macOS (Metal/WebKit) or Linux (Wayland/Hyprland) native desktop shells.
* **New Wallpapers:** Additional scenes, characters, or day/night cycles.

Please review our [Contributing Guide](./CONTRIBUTING.md) to get started.

---

## 🙏 Credits & Attribution

Anemo is built with immense appreciation for the original creators:

* **Visual Artwork:** Based on edited artwork created by **[@aruhshura](https://x.com/aruhshura)**, featured in the video *["don't think about it anymore"](https://www.youtube.com/watch?v=A09aumNef-c)*.
* **Ambient Music:** Sourced and looped from the video *["don't think about it anymore"](https://www.youtube.com/watch?v=A09aumNef-c)*.

All musical and original artistic rights belong to their respective creator. This software is provided under the terms of the [MIT License](./LICENSE) for personal and non-commercial enjoyment.
