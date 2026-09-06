#!/bin/zsh
set -euo pipefail

REPO_DIR="${RTB_OS_DIR:-$HOME/Documents/rtb-os}"
SYNC_DIR="$REPO_DIR/integrations/ada-sync"
ENV_DIR="$HOME/.config/rtb"
ENV_FILE="$ENV_DIR/ada-sync.env"
AGENT_SRC="$SYNC_DIR/com.rtb.ada-sync.plist"
AGENT_DST="$HOME/Library/LaunchAgents/com.rtb.ada-sync.plist"
LABEL="com.rtb.ada-sync"

mkdir -p "$ENV_DIR" "$HOME/Library/LaunchAgents"

if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<'EOF'
SUPABASE_URL=https://qbeficojfoqgzjxrzxyg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=PASTE_SERVICE_ROLE_KEY_HERE
ADA_ARCHIVE_URL=http://127.0.0.1:8790/api/messages/archive?sort=priority
ADA_SYNC_FULL_TEXT=0
ADA_SYNC_ALLOW_INFERRED=0
ADA_SYNC_TIMEOUT_SECONDS=8
EOF
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE"
  echo "Add the Supabase service-role key, then run this installer again."
  exit 2
fi

if grep -q 'PASTE_SERVICE_ROLE_KEY_HERE' "$ENV_FILE"; then
  echo "ADA_SYNC_ERROR: add SUPABASE_SERVICE_ROLE_KEY to $ENV_FILE first." >&2
  exit 2
fi

cp "$AGENT_SRC" "$AGENT_DST"
plutil -lint "$AGENT_DST" >/dev/null

/bin/zsh "$SYNC_DIR/run.sh"

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$AGENT_DST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "Ada cloud sync installed."
echo "Runs every 5 minutes."
echo "Logs: /tmp/rtb-ada-sync.log and /tmp/rtb-ada-sync.err"
