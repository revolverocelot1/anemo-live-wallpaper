# Contributing to Anemo

Thank you for your interest in contributing to Anemo.

Anemo is built as an open-source, non-commercial interactive desktop environment. We prioritize technical discipline, zero-copy performance, and faithful artistic adaptation.

---

## Technical Focus Areas

### 1. Rendering Architecture & Memory Efficiency
* **GPU Memory & Texture Staging:** We maintain a sub-30 MB heap and sub-0.3% CPU target on Windows. Shader optimizations, uniform upload batching, and WebGL state reductions are highly prioritized.
* **Display Sleep & Inactivity Detection:** Extending Windows hook behaviors to detect full-screen exclusive 3D workloads (e.g. video games) to suspend the render loop to 0% GPU utilization automatically.

### 2. High-Resolution 4K Pipeline
* **Master Fidelity:** Anemo is currently mastered at **2K (2560×1440)** due to the resolution of the original asset render.
* **4K Development:** We are actively preparing a native 4K release. Key needs:
  * Re-rendering clean 3840×2160 background loop segments.
  * Sub-pixel vector spline definition for upper and lower eyelid occlusion masks.
  * High-resolution iris and sclera depth layers.

### 3. Community Engine Ports
All segmented assets are cleanly structured in [`assets-raw/`](./assets-raw) to facilitate porting:
* **Steam Wallpaper Engine:** Web/Scene project ports utilizing the decoupled `<video>` and transparent WebGL architecture.
* **Lively Wallpaper:** Lightweight native integration.
* **Unix / Wayland Daemons:** Standalone desktop hooks for Linux (wlroots / Hyprland / KDE).

*(Please ensure that any derivative port prominently preserves original artistic and musical credits.)*

### 4. New Scenes & Rig Customization
* Expanding the core engine beyond a single scene into an extensible system with customizable anchor points, lighting models, and time-of-day transitions.

---

## Local Development Workflow

### Web Engine (TypeScript, React 18, Vite 5)
```bash
cd web-engine
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

To verify production bundle compilation and type safety:
```bash
npm run build
```

### Windows Desktop Host (C#, WebView2)
The desktop host hooks directly behind desktop icons through the Windows `Progman` / `WorkerW` hierarchy:
```powershell
cd desktop-host
powershell -ExecutionPolicy Bypass -File build.ps1
```
This builds `Anemo.exe` and bundles the single-executable installer `AnemoSetup.exe`.

---

## Artistic Attribution & Ethical Standards

Anemo exists through the creative work of its original authors:
* **Artwork:** Based on edited artwork created by **[@aruhshura](https://x.com/aruhshura)** from the video *["don't think about it anymore"](https://www.youtube.com/watch?v=A09aumNef-c)*.
* **Music:** Soundtrack sourced and looped from *["don't think about it anymore"](https://www.youtube.com/watch?v=A09aumNef-c)*.

All contributions must respect and preserve attribution to the original creators.

---

## Submission Process

1. Fork the repository.
2. Create a focused branch (`git checkout -b perf/shader-batching`).
3. Maintain code formatting and ensure `npm run build` passes with zero errors.
4. Submit a Pull Request documenting the design rationale and performance measurements.
