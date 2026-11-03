#!/usr/bin/env bash
# ==============================================================================
# Anemo Live Wallpaper — Linux User-Space Installer (v1.0.4)
# Publisher: Anemoia (https://anemoias.me)
# ==============================================================================

set -e

APP_NAME="Anemo Live Wallpaper (Experimental)"
VERSION="1.0.4"
INSTALL_DIR="$HOME/.local/share/anemo"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Accept optional -y / --yes flag
AUTO_YES=0
for arg in "$@"; do
    if [ "$arg" == "-y" ] || [ "$arg" == "--yes" ]; then
        AUTO_YES=1
    fi
done

echo "========================================================"
echo "  Installing $APP_NAME v$VERSION"
echo "  Publisher: Anemoia"
echo "========================================================"

# 1. Dependency Check
echo "[1/5] Checking Linux dependencies..."
MISSING_DEPS=0

if ! command -v python3 >/dev/null 2>&1; then
    echo "  [ERROR] python3 is not installed."
    MISSING_DEPS=1
fi

python3 -c "import gi; gi.require_version('Gtk', '3.0'); from gi.repository import Gtk" >/dev/null 2>&1 || {
    echo "  [WARNING] PyGObject / GTK 3 typelib not found in Python path."
    MISSING_DEPS=1
}

python3 -c "import gi; gi.require_version('WebKit2', '4.1'); from gi.repository import WebKit2" >/dev/null 2>&1 || \
python3 -c "import gi; gi.require_version('WebKit2', '4.0'); from gi.repository import WebKit2" >/dev/null 2>&1 || {
    echo "  [WARNING] WebKit2GTK (4.1 or 4.0) not found."
    MISSING_DEPS=1
}

if [ "$MISSING_DEPS" -eq 1 ]; then
    echo ""
    echo "========================================================"
    echo "  Notice: Missing Recommended GUI Packages"
    echo "========================================================"
    
    DISTRO=""
    if [ -f /etc/os-release ]; then
        DISTRO=$(grep -E '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"' | tr '[:upper:]' '[:lower:]')
    fi

    echo "To get full background wallpaper support, run:"
    case "$DISTRO" in
        ubuntu|debian|linuxmint|pop|elementary|zorin)
            echo "  sudo apt update && sudo apt install -y python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 gir1.2-ayatanaappindicator3-0.1"
            ;;
        fedora|rhel|centos)
            echo "  sudo dnf install -y python3-gobject gtk3 webkit2gtk4.1 libappindicator-gtk3"
            ;;
        arch|manjaro|endeavouros)
            echo "  sudo pacman -S --needed python-gobject gtk3 webkit2gtk-4.1 libappindicator-gtk3"
            ;;
        opensuse*|suse)
            echo "  sudo zypper install -y python3-gobject typelib-1_0-Gtk-3_0 typelib-1_0-WebKit2-4_1 libappindicator3-1"
            ;;
        *)
            echo "  Ubuntu/Debian: sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 gir1.2-ayatanaappindicator3-0.1"
            echo "  Fedora:        sudo dnf install python3-gobject gtk3 webkit2gtk4.1 libappindicator-gtk3"
            echo "  Arch Linux:    sudo pacman -S python-gobject gtk3 webkit2gtk-4.1 libappindicator-gtk3"
            ;;
    esac
    echo ""
    echo "Note: You can still install now and run 'anemo --browser' anytime."
    echo "========================================================"
    echo ""

    if [ "$AUTO_YES" -eq 0 ] && [ -t 0 ]; then
        read -p "Continue installation anyway? (y/N) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Installation aborted."
            exit 1
        fi
    fi
fi

# 2. Create Target Directories
echo "[2/5] Creating application directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"
mkdir -p "$DESKTOP_DIR"
mkdir -p "$ICON_DIR"

# 3. Copy Application Files
echo "[3/5] Deploying application runtime..."
cp "$SCRIPT_DIR/anemo.py" "$INSTALL_DIR/anemo.py"
cp "$SCRIPT_DIR/uninstall.sh" "$INSTALL_DIR/uninstall.sh"
if [ -d "$SCRIPT_DIR/app" ]; then
    rm -rf "$INSTALL_DIR/app"
    cp -r "$SCRIPT_DIR/app" "$INSTALL_DIR/app"
fi
if [ -f "$SCRIPT_DIR/anemo.png" ]; then
    cp "$SCRIPT_DIR/anemo.png" "$INSTALL_DIR/anemo.png"
    cp "$SCRIPT_DIR/anemo.png" "$ICON_DIR/anemo.png"
fi

chmod +x "$INSTALL_DIR/anemo.py"
chmod +x "$INSTALL_DIR/uninstall.sh"

# 4. Provision Wrapper & Symlink
echo "[4/5] Setting up launcher and menu entries..."
cat << 'EOF' > "$BIN_DIR/anemo"
#!/usr/bin/env bash
exec python3 "$HOME/.local/share/anemo/anemo.py" "$@"
EOF
chmod +x "$BIN_DIR/anemo"

# Desktop Entry
cp "$SCRIPT_DIR/anemo.desktop" "$DESKTOP_DIR/anemo.desktop"
sed -i "s|Icon=anemo|Icon=$ICON_DIR/anemo.png|g" "$DESKTOP_DIR/anemo.desktop" 2>/dev/null || true

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

# 5. Check PATH
echo "[5/5] Checking user PATH..."
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    echo "  Notice: ~/.local/bin is not in your current PATH."
    echo "  To launch 'anemo' from any terminal, add this to your ~/.bashrc or ~/.zshrc:"
    echo '    export PATH="$HOME/.local/bin:$PATH"'
fi

echo ""
echo "========================================================"
echo "  Installation Complete!"
echo "  Launch the wallpaper by typing:"
echo "    anemo"
echo "  Or find 'Anemo Live Wallpaper' in your Applications menu."
echo "========================================================"
