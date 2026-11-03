# Anemo Live Wallpaper v1.0.4

Version **1.0.4** introduces a native, spotless Windows Uninstaller (`Uninstall.exe`), formal Windows Settings & Control Panel Add/Remove integration, standard application manifests, full PE assembly metadata, and cryptographic Authenticode code signing under **Anemoia**.

---

## Downloads

| Package | Size | Description |
| :--- | :--- | :--- |
| **[`AnemoSetup.exe`](https://github.com/revolverocelot1/anemo-live-wallpaper/releases/download/v1.0.4/AnemoSetup.exe)** | **~121.0 MB** | **Recommended.** Single-file standalone installer. Installs to `%LocalAppData%\Programs\Anemo`, provisions Desktop & Start Menu shortcuts, registers in Windows Settings Installed Apps, and launches immediately. |
| **[`Anemo-Live-Wallpaper-Portable.zip`](https://github.com/revolverocelot1/anemo-live-wallpaper/releases/download/v1.0.4/Anemo-Live-Wallpaper-Portable.zip)** | **~120.9 MB** | **Portable Archive.** Extract to any folder and execute `Anemo.exe` directly without installation or registry writes. Includes standalone `Uninstall.exe`. |
| **[`Anemo-Live-Wallpaper-Linux-x64.tar.gz`](https://github.com/revolverocelot1/anemo-live-wallpaper/releases/download/v1.0.4/Anemo-Live-Wallpaper-Linux-x64.tar.gz)** | **~119.8 MB** | **Linux Package (Experimental Preview - X11 & Wayland).** User-space installer (`install.sh`), uninstaller (`uninstall.sh`), native WebKitGTK engine, AppIndicator tray, and zero-dependency browser fallback (`anemo --browser`). |

---

## What's Changed in v1.0.4

- **Experimental Linux Desktop Host (`linux-host/anemo.py`)**:
  - Dual display server support: Wayland (`gtk-layer-shell`) with runtime GNOME safety checks, and X11 (`_NET_WM_WINDOW_TYPE_DESKTOP`).
  - Native FreeDesktop AppIndicator tray menu matching the Windows version.
  - Zero-privilege user-space installation via `install.sh` and clean uninstallation via `uninstall.sh`.
  - Fail-safe fallback modes: `--windowed` (for floating/tiling WMs) and `--browser` (zero GTK/WebKit required).

- **Native Windows Uninstaller (`Uninstall.exe`)**:
  - Implemented a dedicated, dark-themed GUI uninstaller deployed inside `%LocalAppData%\Programs\Anemo\Uninstall.exe`.
  - Supports silent uninstallation (`/silent` or `/s`) for automation and scripts.
  - Automatically terminates running wallpaper processes, removes Windows Startup registry values, purges Desktop and Start Menu shortcuts, and completely deletes the installation directory without leftover traces or requiring third-party cleaning tools.

- **Windows Settings & Control Panel Integration**:
  - Registered in Windows Add/Remove Programs (`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\AnemoLiveWallpaper`).
  - Anemo Live Wallpaper now appears natively in Windows 10 & 11 **Settings -> Apps -> Installed apps** and **Control Panel -> Programs and Features** published by **Anemoia**.
  - Clicking "Uninstall" in Windows Settings directly executes `Uninstall.exe`.
  - Added an "Uninstall Anemo Live Wallpaper" shortcut in the Start Menu and an "Uninstall Anemo..." option in the System Tray context menu.

- **SmartScreen Mitigation & Publisher Identity (Anemoia)**:
  - Embedded a Win32 application manifest (`app.manifest`) into all executables specifying execution level `asInvoker` (proving zero administrative privileges required) and Windows 10/11 compatibility.
  - Added full PE assembly metadata (`AssemblyInfo.cs`): Company name `Anemoia`, Product `Anemo Live Wallpaper`, Copyright, and Version `1.0.4.0`.
  - Digitally signed all binaries (`AnemoSetup.exe`, `Anemo.exe`, `Uninstall.exe`) with an official **Anemoia** Authenticode certificate and DigiCert RFC 3161 cryptographic timestamps.

---

# Anemo Live Wallpaper v1.0.3

Version **1.0.3** addresses desktop visibility on Windows 11 (23H2/24H2), eliminates black screen loading overlays in desktop mode, and enforces strict zero-camera cold booting with minimized memory footprint.

---

## Downloads (v1.0.3)

| Package | Size | Description |
| :--- | :--- | :--- |
| **[`AnemoSetup.exe`](https://github.com/revolverocelot1/anemo-live-wallpaper/releases/download/v1.0.3/AnemoSetup.exe)** | **~120.9 MB** | Single-file standalone installer. |
| **[`Anemo-Live-Wallpaper-Portable.zip`](https://github.com/revolverocelot1/anemo-live-wallpaper/releases/download/v1.0.3/Anemo-Live-Wallpaper-Portable.zip)** | **~120.8 MB** | Portable Archive. |

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
