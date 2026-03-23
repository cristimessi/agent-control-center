#!/bin/bash

set -euo pipefail

LABEL="${AGENT_CONTROL_LAUNCHD_LABEL:-com.emusoi.agent-control-center}"
TARGET_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$(id -u)" "$TARGET_PATH" >/dev/null 2>&1 || true
rm -f "$TARGET_PATH"

echo "Removed LaunchAgent: $LABEL"
