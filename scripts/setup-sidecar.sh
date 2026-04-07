#!/bin/bash
# Build the ant daemon binary for local development.
# Assumes ant-client is in a sibling directory (../ant-client).
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUI_DIR="$(dirname "$SCRIPT_DIR")"
CLIENT_DIR="${ANT_CLIENT_DIR:-$GUI_DIR/../ant-client}"

if [ ! -d "$CLIENT_DIR" ]; then
    echo "ant-client not found at $CLIENT_DIR"
    echo "Set ANT_CLIENT_DIR or clone it as a sibling directory."
    exit 1
fi

echo "Building ant-cli from $CLIENT_DIR..."
cd "$CLIENT_DIR"
cargo build --release -p ant-cli

TARGET=$(rustc -vV | grep host | awk '{print $2}')
mkdir -p "$GUI_DIR/src-tauri/binaries"
cp "target/release/ant" "$GUI_DIR/src-tauri/binaries/ant-${TARGET}"

echo "Sidecar binary installed: src-tauri/binaries/ant-${TARGET}"
