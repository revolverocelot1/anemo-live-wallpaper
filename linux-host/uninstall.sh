#!/usr/bin/env bash
# ==============================================================================
# Anemo Live Wallpaper — Linux Clean Uninstaller (v1.0.4)
# Publisher: Anemoia (https://anemoias.me)
# ==============================================================================

set -e

APP_NAME="Anemo Live Wallpaper"
VERSION="1.0.4"
INSTALL_DIR="$HOME/.local/share/anemo"
BIN_FILE="$HOME/.local/bin/anemo"
DESKTOP_FILE="$HOME/.local/share/applications/anemo.desktop"
ICON_FILE="$HOME/.local/share/icons/hicolor/256x256/apps/anemo.png"
CONFIG_DIR="$HOME/.config/anemo"

echo "========================================================"
echo "  Uninstalling $APP_NAME v$VERSION"
echo "  Publisher: Anemoia"
echo "========================================================"

# 1. Stop Running Instances
echo "[1/4] Stopping any active Anemo processes..."
pkill -f "anemo.py" 2>/dev/null || true
sleep 1

# 2. Remove Binary Wrapper and Shortcuts
echo "[2/4] Removing launcher and menu shortcuts..."
if [ -f "$BIN_FILE" ]; then
    rm -f "$BIN_FILE"
fi
if [ -f "$DESKTOP_FILE" ]; then
    rm -f "$DESKTOP_FILE"
fi
if [ -f "$ICON_FILE" ]; then
    rm -f "$ICON_FILE"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi

# 3. Remove Application Files
echo "[3/4] Purging application runtime from $INSTALL_DIR..."
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
fi

# 4. Remove User Settings
echo "[4/4] Removing user configuration from $CONFIG_DIR..."
if [ -d "$CONFIG_DIR" ]; then
    rm -rf "$CONFIG_DIR"
fi

echo ""
echo "========================================================"
echo "  Anemo Live Wallpaper was completely removed."
echo "  Your Linux system is 100% clean."
echo "========================================================"
