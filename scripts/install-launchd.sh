#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_PATH="$ROOT_DIR/launchd/com.emusoi.agent-control-center.plist.template"
LABEL="${AGENT_CONTROL_LAUNCHD_LABEL:-com.emusoi.agent-control-center}"
PORT="${PORT:-3002}"
LOG_DIR="${AGENT_CONTROL_LOG_DIR:-$HOME/Library/Logs/agent-control-center}"
TARGET_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

sed \
  -e "s#__LABEL__#${LABEL}#g" \
  -e "s#__ROOT_DIR__#${ROOT_DIR}#g" \
  -e "s#__PORT__#${PORT}#g" \
  -e "s#__LOG_DIR__#${LOG_DIR}#g" \
  "$TEMPLATE_PATH" > "$TARGET_PATH"

launchctl bootout "gui/$(id -u)" "$TARGET_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$TARGET_PATH"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

echo "Installed LaunchAgent: $LABEL"
echo "Daemon URL: http://127.0.0.1:${PORT}"
