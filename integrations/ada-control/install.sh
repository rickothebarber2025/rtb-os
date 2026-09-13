#!/bin/zsh
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_DIR="$HOME/.config/rtb"
ENV_FILE="$ENV_DIR/ada-control.env"
PLIST="$HOME/Library/LaunchAgents/com.rtb.ada-control.plist"
RUNTIME_DIR="$HOME/.local/lib/rtb/ada-control"
RUNTIME_SCRIPT="$RUNTIME_DIR/ada_control_server.py"
mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"
/usr/bin/install -d -m 700 "$RUNTIME_DIR"
/usr/bin/install -m 600 "$REPO_DIR/integrations/ada-control/ada_control_server.py" "$RUNTIME_SCRIPT"

if [[ ! -f "$ENV_FILE" ]]; then
  TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
)"
  cat > "$ENV_FILE" <<EOF
ADA_CONTROL_TOKEN=$TOKEN
ADA_CONTROL_PORT=8791
RTB_OS_REPO=$REPO_DIR
ADA_ARCHIVE_URL=http://127.0.0.1:8790/api/messages/archive?sort=priority
ADA_ARCHIVE_SYNC_URL=http://127.0.0.1:8790/api/messages/archive/sync
NEURAL_WORKBENCH_DIR=$HOME/Downloads/neural-workbench
NEURAL_WORKBENCH_HEALTH_URL=http://127.0.0.1:3000/api/health
EOF
  chmod 600 "$ENV_FILE"
else
  grep -q '^NEURAL_WORKBENCH_DIR=' "$ENV_FILE" || echo "NEURAL_WORKBENCH_DIR=$HOME/Downloads/neural-workbench" >> "$ENV_FILE"
  grep -q '^NEURAL_WORKBENCH_HEALTH_URL=' "$ENV_FILE" || echo "NEURAL_WORKBENCH_HEALTH_URL=http://127.0.0.1:3000/api/health" >> "$ENV_FILE"
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.rtb.ada-control</string>
<key>ProgramArguments</key><array><string>/bin/zsh</string><string>-lc</string><string>set -a; source "$ENV_FILE"; set +a; exec /usr/bin/python3 "$RUNTIME_SCRIPT"</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><false/>
<key>StandardOutPath</key><string>/tmp/rtb-ada-control.log</string>
<key>StandardErrorPath</key><string>/tmp/rtb-ada-control.err</string>
</dict></plist>
EOF

launchctl bootout "gui/$(id -u)/com.rtb.ada-control" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo
echo "A.R.V.I.S. control bridge installed on localhost:8791."
echo "Neural Workbench directory: $(grep '^NEURAL_WORKBENCH_DIR=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
echo "Now expose the control bridge privately with Tailscale Serve:"
echo "  tailscale serve --bg 8791"
echo "The control token remains private in $ENV_FILE."
