#!/usr/bin/env python3
"""
Anemo Live Wallpaper — Native Linux Desktop Host (v1.0.4)
Publisher: Anemoia (https://anemoias.me)

Features:
  - Dual Display Server:
      * Wayland: gtk-layer-shell (ZWLR_LAYER_SHELL_V1_LAYER_BACKGROUND)
      * X11: GDK/X11 Desktop Type Hint (_NET_WM_WINDOW_TYPE_DESKTOP)
  - Hardware-Accelerated WebKit2GTK viewport with zero-latency loopback streaming
  - FreeDesktop Ayatana/AppIndicator system tray with live controls
  - Fallback Modes:
      * --windowed: Run inside a floating window for testing or tiling WMs
      * --browser: Host local engine and open in user's default browser
  - Settings persistence in ~/.config/anemo/settings.json
"""

import sys
import os
import json
import socket
import signal
import argparse
import threading
import http.server
import socketserver
import webbrowser
from pathlib import Path

VERSION = "1.0.4"
APP_TITLE = "Anemo Live Wallpaper (Experimental)"
PUBLISHER = "Anemoia"

# ---------------------------------------------------------------------------
# Path Resolution & Settings
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = SCRIPT_DIR / "app"
if not APP_DIR.exists():
    # Development fallback to sibling web-engine dist
    APP_DIR = SCRIPT_DIR.parent / "web-engine" / "dist"

CONFIG_DIR = Path.home() / ".config" / "anemo"
CONFIG_FILE = CONFIG_DIR / "settings.json"

DEFAULT_SETTINGS = {
    "mode": "mouse",
    "iris_style": "classic",
    "eyelid_follow": 0.30,
    "bgm_enabled": False,
    "bgm_volume": 0.50,
    "paused": False
}

def load_settings():
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                res = DEFAULT_SETTINGS.copy()
                res.update(data)
                # Enforce cold-boot mouse mode (0% camera on fresh start)
                res["mode"] = "mouse"
                return res
        except Exception:
            pass
    return DEFAULT_SETTINGS.copy()

def save_settings(s):
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(s, f, indent=2)
    except Exception as e:
        print(f"Warning: could not save settings: {e}")

# ---------------------------------------------------------------------------
# Threaded Local HTTP Daemon
# ---------------------------------------------------------------------------
class QuietHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def log_message(self, format, *args):
        # Suppress routine GET request spam in terminal
        pass

    def end_headers(self):
        # Enable COOP / COEP for WASM threading and SharedArrayBuffer
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def guess_type(self, path):
        if path.endswith('.wasm'):
            return 'application/wasm'
        if path.endswith('.mp4'):
            return 'video/mp4'
        if path.endswith('.json'):
            return 'application/json'
        if path.endswith('.js'):
            return 'application/javascript'
        return super().guess_type(path)

class ReusableServer(socketserver.TCPServer):
    allow_reuse_address = True

def find_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port

# ---------------------------------------------------------------------------
# CLI Arguments Parser
# ---------------------------------------------------------------------------
def parse_arguments():
    parser = argparse.ArgumentParser(
        prog="anemo",
        description=f"{APP_TITLE} v{VERSION} — Interactive 2.5D Desktop Host for Linux"
    )
    parser.add_argument(
        "-v", "--version",
        action="version",
        version=f"{APP_TITLE} v{VERSION} ({PUBLISHER})"
    )
    parser.add_argument(
        "-w", "--windowed",
        action="store_true",
        help="Run in a standalone floating window instead of desktop background"
    )
    parser.add_argument(
        "-b", "--browser",
        action="store_true",
        help="Host the local engine and open in your default browser (no WebKitGTK required)"
    )
    parser.add_argument(
        "-p", "--port",
        type=int,
        default=0,
        help="Port for local HTTP daemon (default: automatic ephemeral port)"
    )
    return parser.parse_args()

# ---------------------------------------------------------------------------
# Distro-Aware Package Help
# ---------------------------------------------------------------------------
def print_distro_instructions():
    print("=" * 60)
    print(f"  Missing GUI dependencies for {APP_TITLE}")
    print("=" * 60)
    print("Please install the required packages for your distribution:\n")

    distro = ""
    try:
        with open("/etc/os-release", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("ID="):
                    distro = line.strip().split("=")[1].strip('"').lower()
                    break
    except Exception:
        pass

    if distro in ("ubuntu", "debian", "linuxmint", "pop", "elementary", "zorin"):
        print("  sudo apt update && sudo apt install -y \\")
        print("    python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 gir1.2-ayatanaappindicator3-0.1\n")
    elif distro in ("fedora", "rhel", "centos"):
        print("  sudo dnf install -y \\")
        print("    python3-gobject gtk3 webkit2gtk4.1 libappindicator-gtk3\n")
    elif distro in ("arch", "manjaro", "endeavouros"):
        print("  sudo pacman -S --needed \\")
        print("    python-gobject gtk3 webkit2gtk-4.1 libappindicator-gtk3\n")
    elif distro in ("opensuse", "suse"):
        print("  sudo zypper install -y \\")
        print("    python3-gobject typelib-1_0-Gtk-3_0 typelib-1_0-WebKit2-4_1 libappindicator3-1\n")
    else:
        print("  Ubuntu/Debian: sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 gir1.2-ayatanaappindicator3-0.1")
        print("  Fedora:        sudo dnf install python3-gobject gtk3 webkit2gtk4.1 libappindicator-gtk3")
        print("  Arch Linux:    sudo pacman -S python-gobject gtk3 webkit2gtk-4.1 libappindicator-gtk3")
        print("  openSUSE:      sudo zypper install python3-gobject typelib-1_0-Gtk-3_0 typelib-1_0-WebKit2-4_1 libappindicator3-1\n")

    print("Tip: You can also run in browser mode without WebKitGTK:")
    print("  anemo --browser")
    print("=" * 60)

# ---------------------------------------------------------------------------
# Main GTK & WebKit Application
# ---------------------------------------------------------------------------
def run_gtk_app(args, port):
    import gi
    try:
        gi.require_version('Gtk', '3.0')
        gi.require_version('Gdk', '3.0')
        try:
            gi.require_version('WebKit2', '4.1')
        except (ValueError, AttributeError):
            gi.require_version('WebKit2', '4.0')
    except Exception as e:
        print(f"Error loading GTK / WebKit libraries: {e}")
        print_distro_instructions()
        sys.exit(1)

    from gi.repository import Gtk, Gdk, GLib, WebKit2

    # Layer shell detection for Wayland
    has_layer_shell = False
    GtkLayerShell = None
    try:
        gi.require_version('GtkLayerShell', '0.1')
        from gi.repository import GtkLayerShell as _GtkLayerShell
        GtkLayerShell = _GtkLayerShell
        has_layer_shell = True
    except (ValueError, ImportError, AttributeError):
        has_layer_shell = False

    # AppIndicator detection for System Tray
    has_app_indicator = False
    AppIndicator = None
    try:
        gi.require_version('AyatanaAppIndicator3', '0.1')
        from gi.repository import AyatanaAppIndicator3 as AppIndicator
        has_app_indicator = True
    except (ValueError, ImportError, AttributeError):
        try:
            gi.require_version('AppIndicator3', '0.1')
            from gi.repository import AppIndicator3 as AppIndicator
            has_app_indicator = True
        except (ValueError, ImportError, AttributeError):
            has_app_indicator = False

    class AnemoLinuxApp:
        def __init__(self):
            self.settings = load_settings()
            self.port = port
            self.windowed = args.windowed
            self.is_wayland = self._check_is_wayland()

            print(f"Starting {APP_TITLE} v{VERSION} by {PUBLISHER}")
            print(f"Mode: {'Windowed' if self.windowed else 'Desktop Wallpaper'}")
            print(f"Display Server: {'Wayland' if self.is_wayland else 'X11'}")
            print(f"Web Engine Path: {APP_DIR}")

            # Build GTK Window & Viewport
            self._init_window()

            # Build Tray Menu
            self._init_tray()

            # Hook X11 cursor tracking if running full desktop on X11
            if not self.windowed and not self.is_wayland:
                GLib.timeout_add(33, self._poll_x11_pointer)

            # Keep Python signal loop responsive
            GLib.timeout_add(500, lambda: True)

        def _check_is_wayland(self):
            w_disp = os.environ.get("WAYLAND_DISPLAY", "").lower()
            x_type = os.environ.get("XDG_SESSION_TYPE", "").lower()
            return bool("wayland" in w_disp or "wayland" in x_type)

        def _init_window(self):
            self.window = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
            self.window.set_title(APP_TITLE)

            # Query Display Geometry
            display = Gdk.Display.get_default()
            self.screen_width = 1920
            self.screen_height = 1080
            screen_x = 0
            screen_y = 0

            if display:
                monitor = display.get_primary_monitor()
                if not monitor and display.get_n_monitors() > 0:
                    monitor = display.get_monitor(0)
                if monitor:
                    geom = monitor.get_geometry()
                    self.screen_width = geom.width
                    self.screen_height = geom.height
                    screen_x = geom.x
                    screen_y = geom.y

            if self.windowed:
                # Standalone Windowed Mode
                self.window.set_decorated(True)
                self.window.set_default_size(1280, 720)
                self.window.set_position(Gtk.WindowPosition.CENTER)
                self.window.connect("destroy", lambda w: Gtk.main_quit())
            else:
                # Desktop Wallpaper Mode
                self.window.set_decorated(False)
                self.window.set_app_paintable(True)

                # Set transparent visual if composited
                screen = self.window.get_screen()
                visual = screen.get_rgba_visual()
                if visual:
                    self.window.set_visual(visual)

                # Wayland Layer Shell support check
                can_layer_shell = False
                if self.is_wayland and has_layer_shell and GtkLayerShell:
                    try:
                        can_layer_shell = GtkLayerShell.is_supported()
                    except Exception:
                        can_layer_shell = False

                if can_layer_shell:
                    print("Applying Wayland Layer-Shell background layer...")
                    GtkLayerShell.init_for_window(self.window)
                    GtkLayerShell.set_layer(self.window, GtkLayerShell.Layer.BACKGROUND)
                    GtkLayerShell.set_exclusive_zone(self.window, -1)
                    GtkLayerShell.set_anchor(self.window, GtkLayerShell.Edge.TOP, True)
                    GtkLayerShell.set_anchor(self.window, GtkLayerShell.Edge.BOTTOM, True)
                    GtkLayerShell.set_anchor(self.window, GtkLayerShell.Edge.LEFT, True)
                    GtkLayerShell.set_anchor(self.window, GtkLayerShell.Edge.RIGHT, True)
                    GtkLayerShell.set_keyboard_mode(self.window, GtkLayerShell.KeyboardMode.NONE)
                else:
                    print("Applying X11 Desktop Window hints...")
                    self.window.set_type_hint(Gdk.WindowTypeHint.DESKTOP)
                    self.window.set_keep_below(True)
                    self.window.stick()
                    self.window.set_default_size(self.screen_width, self.screen_height)
                    self.window.move(screen_x, screen_y)

            # WebKit2 Settings
            wk_settings = WebKit2.Settings()
            wk_settings.set_enable_webgl(True)
            wk_settings.set_enable_media_stream(True)
            wk_settings.set_enable_mediasource(True)
            wk_settings.set_enable_smooth_scrolling(False)
            wk_settings.set_enable_developer_extras(False)
            wk_settings.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.ALWAYS)

            # WebKit2 WebView
            self.webview = WebKit2.WebView.new_with_settings(wk_settings)
            self.webview.set_background_color(Gdk.RGBA(0, 0, 0, 1))

            self.window.add(self.webview)
            self.window.show_all()

            if not self.windowed and not self.is_wayland:
                gdk_win = self.window.get_window()
                if gdk_win:
                    gdk_win.lower()

            # Load Anemo Desktop URL
            target_url = f"http://127.0.0.1:{self.port}/index.html?desktop=1"
            self.webview.load_uri(target_url)
            self.webview.connect("load-changed", self._on_load_changed)

        def _on_load_changed(self, webview, event):
            if event == WebKit2.LoadEvent.FINISHED:
                print("Wallpaper web engine loaded successfully.")
                self.post_message({"type": "mode", "value": self.settings["mode"]})
                self.post_message({"type": "irisStyle", "value": self.settings["iris_style"]})
                self.post_message({"type": "eyelid", "value": self.settings["eyelid_follow"]})
                self.post_message({"type": "music", "value": self.settings["bgm_enabled"]})
                self.post_message({"type": "musicVolume", "value": self.settings["bgm_volume"]})
                if self.settings["paused"]:
                    self.post_message({"type": "pause", "value": True})

        def post_message(self, data):
            js = f"window.postMessage({json.dumps(data)}, '*');"
            self.webview.run_javascript(js, None, None, None)

        def _init_tray(self):
            icon_path = str(SCRIPT_DIR / "anemo.png")
            if not os.path.exists(icon_path):
                icon_path = "applications-graphics"

            if has_app_indicator and AppIndicator:
                self.tray = AppIndicator.Indicator.new(
                    "anemo-live-wallpaper",
                    icon_path,
                    AppIndicator.IndicatorCategory.APPLICATION_STATUS
                )
                self.tray.set_status(AppIndicator.IndicatorStatus.ACTIVE)
                self.tray.set_menu(self._build_tray_menu())
            else:
                self.tray = Gtk.StatusIcon()
                if os.path.exists(icon_path):
                    self.tray.set_from_file(icon_path)
                else:
                    self.tray.set_from_icon_name("applications-graphics")
                self.tray.set_tooltip_text(APP_TITLE)
                self.tray.connect("popup-menu", self._on_status_icon_popup)

        def _on_status_icon_popup(self, icon, button, activate_time):
            menu = self._build_tray_menu()
            menu.popup(None, None, None, None, button, activate_time)

        def _build_tray_menu(self):
            menu = Gtk.Menu()

            mi_title = Gtk.MenuItem(label=f"{APP_TITLE} (v{VERSION})")
            mi_title.set_sensitive(False)
            menu.append(mi_title)
            menu.append(Gtk.SeparatorMenuItem())

            mi_center = Gtk.MenuItem(label="Center Here (Look at Roxy)")
            mi_center.connect("activate", lambda w: self.post_message({"type": "center"}))
            menu.append(mi_center)

            mi_calib = Gtk.MenuItem(label="Calibrate Camera (3s countdown)")
            mi_calib.connect("activate", lambda w: self.post_message({"type": "calibrate"}))
            menu.append(mi_calib)

            menu.append(Gtk.SeparatorMenuItem())

            # Tracking Mode
            mi_mode = Gtk.MenuItem(label="Tracking Mode")
            mode_menu = Gtk.Menu()
            group = None
            modes = [
                ("mouse", "Mouse Tracking (0% Camera)"),
                ("person", "Person Tracker (Head Anchor)"),
                ("gaze", "Precise Gaze Contact")
            ]
            for key, label in modes:
                rb = Gtk.RadioMenuItem.new_with_label_from_widget(group, label)
                if not group: group = rb
                rb.set_active(self.settings["mode"] == key)
                rb.connect("toggled", self._make_mode_handler(key))
                mode_menu.append(rb)
            mi_mode.set_submenu(mode_menu)
            menu.append(mi_mode)

            # Iris Style
            mi_iris = Gtk.MenuItem(label="Iris Style")
            iris_menu = Gtk.Menu()
            i_group = None
            for key, label in [("classic", "Classic (Anime Specular)"), ("focused", "Focused (Centered Pupil)")]:
                rb = Gtk.RadioMenuItem.new_with_label_from_widget(i_group, label)
                if not i_group: i_group = rb
                rb.set_active(self.settings["iris_style"] == key)
                rb.connect("toggled", self._make_iris_handler(key))
                iris_menu.append(rb)
            mi_iris.set_submenu(iris_menu)
            menu.append(mi_iris)

            # Eyelid Follow
            mi_eyelid = Gtk.MenuItem(label="Eyelid Follow")
            eyelid_menu = Gtk.Menu()
            e_group = None
            for val, label in [
                (0.0, "0% (Static Lids)"),
                (0.30, "30% (Natural)"),
                (0.60, "60% (Expressive)"),
                (1.0, "100% (Full Follow)")
            ]:
                rb = Gtk.RadioMenuItem.new_with_label_from_widget(e_group, label)
                if not e_group: e_group = rb
                rb.set_active(abs(self.settings["eyelid_follow"] - val) < 0.05)
                rb.connect("toggled", self._make_eyelid_handler(val))
                eyelid_menu.append(rb)
            mi_eyelid.set_submenu(eyelid_menu)
            menu.append(mi_eyelid)

            # Ambient Music
            mi_music = Gtk.CheckMenuItem(label="Ambient Music (1-hr loop)")
            mi_music.set_active(self.settings["bgm_enabled"])
            mi_music.connect("toggled", self._on_music_toggled)
            menu.append(mi_music)

            menu.append(Gtk.SeparatorMenuItem())

            # Pause Wallpaper
            self.mi_pause = Gtk.CheckMenuItem(label="Pause Wallpaper")
            self.mi_pause.set_active(self.settings["paused"])
            self.mi_pause.connect("toggled", self._on_pause_toggled)
            menu.append(self.mi_pause)

            # Quit
            mi_quit = Gtk.MenuItem(label="Quit Anemo")
            mi_quit.connect("activate", lambda w: Gtk.main_quit())
            menu.append(mi_quit)

            menu.show_all()
            return menu

        def _make_mode_handler(self, mode_key):
            def handler(widget):
                if widget.get_active():
                    self.settings["mode"] = mode_key
                    save_settings(self.settings)
                    self.post_message({"type": "mode", "value": mode_key})
            return handler

        def _make_iris_handler(self, style_key):
            def handler(widget):
                if widget.get_active():
                    self.settings["iris_style"] = style_key
                    save_settings(self.settings)
                    self.post_message({"type": "irisStyle", "value": style_key})
            return handler

        def _make_eyelid_handler(self, val):
            def handler(widget):
                if widget.get_active():
                    self.settings["eyelid_follow"] = val
                    save_settings(self.settings)
                    self.post_message({"type": "eyelid", "value": val})
            return handler

        def _on_music_toggled(self, widget):
            enabled = widget.get_active()
            self.settings["bgm_enabled"] = enabled
            save_settings(self.settings)
            self.post_message({"type": "music", "value": enabled})

        def _on_pause_toggled(self, widget):
            paused = widget.get_active()
            self.settings["paused"] = paused
            save_settings(self.settings)
            self.post_message({"type": "pause", "value": paused})

        def _poll_x11_pointer(self):
            if self.settings["paused"] or self.settings["mode"] != "mouse":
                return True

            display = Gdk.Display.get_default()
            if not display: return True
            seat = display.get_default_seat()
            if not seat: return True
            pointer = seat.get_pointer()
            if not pointer: return True

            screen, x, y = pointer.get_position()
            if self.screen_width > 0 and self.screen_height > 0:
                nx = max(0.0, min(1.0, x / self.screen_width))
                ny = max(0.0, min(1.0, y / self.screen_height))
                self.post_message({"type": "cursor", "x": nx, "y": ny})

            return True

    # Connect signal handlers for clean terminal termination
    signal.signal(signal.SIGINT, lambda sig, frame: Gtk.main_quit())
    signal.signal(signal.SIGTERM, lambda sig, frame: Gtk.main_quit())

    app = AnemoLinuxApp()
    try:
        Gtk.main()
    except KeyboardInterrupt:
        pass
    print("Anemo Live Wallpaper exiting cleanly.")

# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------
def main():
    args = parse_arguments()

    if not APP_DIR.exists():
        print(f"Error: Application bundle not found at {APP_DIR}")
        print("Please ensure the 'app' directory exists or build web assets.")
        sys.exit(1)

    port = args.port if args.port > 0 else find_free_port()

    # Start Local Loopback Server
    server = ReusableServer(('127.0.0.1', port), QuietHTTPHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    print(f"Local server listening on http://127.0.0.1:{port}")

    if args.browser:
        target_url = f"http://127.0.0.1:{port}/index.html?desktop=1"
        print(f"Opening Anemo in default web browser: {target_url}")
        webbrowser.open(target_url)
        print("Press Ctrl+C to terminate.")
        try:
            while True:
                threading.Event().wait(1.0)
        except KeyboardInterrupt:
            print("\nShutting down Anemo server.")
            server.shutdown()
            sys.exit(0)
    else:
        try:
            run_gtk_app(args, port)
        finally:
            server.shutdown()

if __name__ == "__main__":
    main()
