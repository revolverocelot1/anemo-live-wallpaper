# Contributing to Anemo

First off, thank you for your interest in making **Anemo** even better! 

Anemo is built by and for the open-source community as an interactive, zero-compromise desktop wallpaper experience. We strive for high craft, clean code, and zero AI-slop design.

---

## 🌟 High-Priority Areas for Contribution

### 1. Performance & Shader Optimizations
* **Zero-Copy & Memory Footprint:** We got the JS heap down to ~26 MB and CPU usage below 0.3%. If you know techniques in WebGL, Direct3D11, or V8 memory tuning to shave off even more cycles or reduce GPU draw calls, we want your PRs!
* **Window Inactivity & Sleep States:** Enhancing pause detection when a full-screen game or heavy application takes focus on Windows.

### 2. Resolution Roadmap: 4K & Beyond
* **Current Resolution:** Anemo currently runs at **2K (2560×1440)** because the original source artwork and animation render were produced at that fidelity.
* **4K Native Version:** We are actively planning a native 4K release with re-rendered video loops, high-definition vector eyelid splines, and ultra-crisp pupil masks. If you are skilled in clean video enhancement, texture rigging, or digital cleanup, your contributions here are immense.

### 3. Ports for Other Wallpaper Engines
* We have provided the full raw segmented asset pipeline in [`assets-raw/`](./assets-raw):
  * `bg_loop.mp4` (hardware video loop)
  * `face_anchor.png` (alpha-masked 2.5D anchor)
  * `pupil_mask.png`, `eyes_open.png`, and iris presets
  * `bgm.mp3` (ambient atmospheric audio)
* **You are 100% encouraged to adapt these assets and create ports for:**
  * **Steam Wallpaper Engine** (Scene / Web / Video project)
  * **Lively Wallpaper**
  * **macOS Desktop** (e.g. via Swift / Metal or WebKit host)
  * **Linux (Wayland / Hyprland / KDE / X11)** live wallpaper daemons
* *Please ensure you maintain the artist and music attribution (see Attribution below) in any published port.*

### 4. New Wallpapers & Character Presets
* Help us expand Anemo from a single character into an expandable live wallpaper engine with selectable scenes, day/night cycles, and customizable eye rigs.

---

## 🛠️ Local Development Setup

### Web Engine (TypeScript + React + Vite)
```bash
cd web-engine
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

To verify production builds:
```bash
npm run build
```

### Desktop Windows Host (C# + WebView2)
The desktop host hooks directly behind desktop icons using the Windows `WorkerW` / `Progman` hierarchy:
```powershell
cd desktop-host
powershell -ExecutionPolicy Bypass -File build.ps1
```
This builds `Anemo.exe` and packages `AnemoSetup.exe`.

---

## 🎨 Attribution & Respect for Creators
Anemo exists thanks to the original creative works:
- **Visual Art:** Edited artwork of **[@aruhshura](https://x.com/aruhshura)** from the video *["don't think about it anymore"](https://www.youtube.com/watch?v=A09aumNef-c)*.
- **Audio:** Music sourced and looped from *["don't think about it anymore"](https://www.youtube.com/watch?v=A09aumNef-c)*.

All contributions must preserve full attribution to the original creator.

---

## 🚀 Submitting Changes
1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/awesome-optimization`).
3. Commit your changes (`git commit -m 'Optimize WebGL uniform uploads'`).
4. Push to the branch (`git push origin feature/awesome-optimization`).
5. Open a Pull Request with a clear description and benchmark/screenshot if applicable.
