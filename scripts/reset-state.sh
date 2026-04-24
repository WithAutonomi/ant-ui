#!/bin/bash
# Wipe all Autonomi GUI and ant daemon/node state so the next run starts
# from a clean setup. Covers both Linux and macOS; Windows has a separate
# scripts/reset-state.ps1.
#
# This deletes: GUI settings, upload history, datamaps, the node registry,
# node data and logs, the cached ant-node binaries, and the saorsa-core
# bootstrap-peer cache (the P2P stack auto-creates one in the OS cache dir
# under saorsa/bootstrap/, so old testnet peers persist there otherwise).
# On macOS it also removes the DMG-installed Autonomi.app bundle from
# /Applications. Wallet keys are NOT persisted on disk (they come from the
# SECRET_KEY env var), so nothing secret is at risk.
set -e

YES=0
for arg in "$@"; do
    case "$arg" in
        -y|--yes) YES=1 ;;
        -h|--help)
            cat <<EOF
Usage: $0 [--yes]

Stops the Autonomi GUI and ant daemon, then removes all GUI and ant
state directories. Prompts before deleting unless --yes is given.
EOF
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            exit 1
            ;;
    esac
done

case "$(uname -s)" in
    Linux)
        GUI_STATE="${XDG_CONFIG_HOME:-$HOME/.config}/autonomi/ant-gui"
        ANT_DATA="${XDG_DATA_HOME:-$HOME/.local/share}/ant"
        ANT_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/ant"
        ANT_LOGS=""
        SAORSA_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/saorsa"
        ;;
    Darwin)
        GUI_STATE="$HOME/Library/Application Support/autonomi/ant-gui"
        ANT_DATA="$HOME/Library/Application Support/ant"
        ANT_CONFIG=""
        ANT_LOGS="$HOME/Library/Logs/ant"
        SAORSA_CACHE="$HOME/Library/Caches/saorsa"
        APP_BUNDLES=("/Applications/Autonomi.app" "$HOME/Applications/Autonomi.app")
        ;;
    *)
        echo "Unsupported OS: $(uname -s). Use scripts/reset-state.ps1 on Windows." >&2
        exit 1
        ;;
esac

# Collect custom node paths referenced by the registry before we wipe it,
# so nodes created with --data-dir-path / --log-dir-path outside the
# default ant tree are also removed.
CUSTOM_PATHS=()
REGISTRY="$ANT_DATA/node_registry.json"
if [ -f "$REGISTRY" ]; then
    if command -v jq >/dev/null 2>&1; then
        while IFS= read -r path; do
            if [ -z "$path" ] || [ "$path" = "null" ]; then
                continue
            fi
            case "$path" in
                "$ANT_DATA"/*|"$ANT_LOGS"/*) ;;
                *) CUSTOM_PATHS+=("$path") ;;
            esac
        done < <(jq -r '.nodes // {} | to_entries[].value | (.data_dir // empty), (.log_dir // empty)' "$REGISTRY" 2>/dev/null)
    else
        echo "warning: jq not installed — nodes created with a custom --data-dir-path"
        echo "         will not be discovered; only default paths will be wiped."
    fi
fi

TARGETS=("$GUI_STATE" "$ANT_DATA")
[ -n "$ANT_CONFIG" ] && TARGETS+=("$ANT_CONFIG")
[ -n "$ANT_LOGS" ] && TARGETS+=("$ANT_LOGS")
[ -n "$SAORSA_CACHE" ] && TARGETS+=("$SAORSA_CACHE")
if [ "${#CUSTOM_PATHS[@]}" -gt 0 ]; then
    TARGETS+=("${CUSTOM_PATHS[@]}")
fi
# On macOS, also remove the DMG-installed .app bundle(s).
if [ "${#APP_BUNDLES[@]}" -gt 0 ]; then
    TARGETS+=("${APP_BUNDLES[@]}")
fi

echo "The following paths will be deleted:"
for t in "${TARGETS[@]}"; do
    if [ -e "$t" ]; then
        echo "  - $t"
    else
        echo "  - $t  (not present)"
    fi
done

if [ "$YES" -ne 1 ]; then
    printf "Continue? [y/N] "
    read -r REPLY
    case "$REPLY" in
        y|Y|yes|YES) ;;
        *) echo "Aborted."; exit 1 ;;
    esac
fi

echo ""
echo "Stopping Autonomi GUI and ant processes..."
PROC_NAMES=(Autonomi ant-gui ant ant-node)
for name in "${PROC_NAMES[@]}"; do
    pkill -TERM -x "$name" 2>/dev/null || true
done
sleep 1
for name in "${PROC_NAMES[@]}"; do
    pkill -KILL -x "$name" 2>/dev/null || true
done

# Extra daemon cleanup via PID file, in case a detached daemon is still up.
PID_FILE="$ANT_DATA/daemon.pid"
if [ -f "$PID_FILE" ]; then
    DAEMON_PID="$(tr -d '[:space:]' < "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$DAEMON_PID" ] && [ "$DAEMON_PID" -eq "$DAEMON_PID" ] 2>/dev/null; then
        if kill -0 "$DAEMON_PID" 2>/dev/null; then
            kill -TERM "$DAEMON_PID" 2>/dev/null || true
            sleep 1
            kill -KILL "$DAEMON_PID" 2>/dev/null || true
        fi
    fi
fi

echo ""
echo "Deleting directories..."
FAILED=0
for t in "${TARGETS[@]}"; do
    if [ -e "$t" ]; then
        if rm -rf -- "$t" 2>/dev/null; then
            echo "  removed: $t"
        else
            echo "  FAILED:  $t (permission denied — re-run with sudo)"
            FAILED=1
        fi
    fi
done

echo ""
if [ "$FAILED" -ne 0 ]; then
    echo "Reset finished with errors — some paths could not be removed."
    exit 1
fi
echo "Reset complete."

