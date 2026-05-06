#!/bin/bash
# Download a prebuilt ant daemon sidecar from the WithAutonomi/ant-client
# GitHub releases and place it where Tauri expects it. Mirrors the
# `download ant daemon sidecar` step in .github/workflows/release.yml so
# that building from source works without cloning ant-client too.
#
# Usage:
#   scripts/download-sidecar.sh                  # latest ant-client release
#   ANT_TAG=ant-cli-v0.1.2 scripts/download-sidecar.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUI_DIR="$(dirname "$SCRIPT_DIR")"

require() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "error: '$1' is required but not installed" >&2
        exit 1
    }
}

require curl
require tar

# Tauri target triple (e.g. x86_64-unknown-linux-gnu)
CROSS_TARGET=$(rustc -vV | awk '/^host:/ {print $2}')
if [ -z "$CROSS_TARGET" ]; then
    echo "error: could not determine host triple from rustc" >&2
    exit 1
fi

# ant-client publishes musl builds for Linux; map gnu -> musl for the asset name.
ANT_TARGET="${CROSS_TARGET/unknown-linux-gnu/unknown-linux-musl}"

# Resolve tag (latest by default)
if [ -z "${ANT_TAG:-}" ]; then
    echo "Resolving latest ant-client release..."
    ANT_TAG=$(curl -fsSL https://api.github.com/repos/WithAutonomi/ant-client/releases/latest \
        | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' \
        | head -n1 | sed 's/.*"\([^"]*\)"$/\1/')
    if [ -z "$ANT_TAG" ]; then
        echo "error: could not resolve latest ant-client release" >&2
        exit 1
    fi
fi
ANT_VERSION="${ANT_TAG#ant-cli-v}"

# Asset extension differs by OS
case "$ANT_TARGET" in
    *windows*) EXT="zip" ;;
    *)         EXT="tar.gz" ;;
esac
ASSET="ant-${ANT_VERSION}-${ANT_TARGET}.${EXT}"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

URL="https://github.com/WithAutonomi/ant-client/releases/download/${ANT_TAG}/${ASSET}"
echo "Downloading $ASSET from $ANT_TAG"
curl -fsSL -o "$TMPDIR/$ASSET" "$URL"

if [ "$EXT" = "tar.gz" ]; then
    tar -xzf "$TMPDIR/$ASSET" -C "$TMPDIR"
else
    require unzip
    unzip -q "$TMPDIR/$ASSET" -d "$TMPDIR"
fi

EXTRACTED_DIR="$TMPDIR/ant-${ANT_VERSION}-${ANT_TARGET}"
mkdir -p "$GUI_DIR/src-tauri/binaries"
case "$ANT_TARGET" in
    *windows*)
        cp "$EXTRACTED_DIR/ant.exe" "$GUI_DIR/src-tauri/binaries/ant-${CROSS_TARGET}.exe"
        echo "Sidecar binary installed: src-tauri/binaries/ant-${CROSS_TARGET}.exe"
        ;;
    *)
        cp "$EXTRACTED_DIR/ant" "$GUI_DIR/src-tauri/binaries/ant-${CROSS_TARGET}"
        chmod +x "$GUI_DIR/src-tauri/binaries/ant-${CROSS_TARGET}"
        echo "Sidecar binary installed: src-tauri/binaries/ant-${CROSS_TARGET}"
        ;;
esac

# Bundle the bootstrap_peers.toml that ships with this daemon version so the
# embedded ant-core client can connect on a fresh install.
PEERS_SRC="$EXTRACTED_DIR/bootstrap_peers.toml"
if [ -f "$PEERS_SRC" ]; then
    mkdir -p "$GUI_DIR/src-tauri/resources"
    cp "$PEERS_SRC" "$GUI_DIR/src-tauri/resources/bootstrap_peers.toml"
    echo "Bootstrap peers refreshed: src-tauri/resources/bootstrap_peers.toml"
else
    echo "Warning: bootstrap_peers.toml not found in $ASSET — keeping vendored snapshot"
fi
