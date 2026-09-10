#!/bin/zsh
set -euo pipefail

LABEL="com.rtb.ada-control"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST"
rm -rf "$HOME/.local/lib/rtb/ada-control"
rm -f "$HOME/.config/rtb/ada-control.env"

echo "Ada control bridge disabled and its local token revoked."
