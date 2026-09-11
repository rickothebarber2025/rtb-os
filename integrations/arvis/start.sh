#!/bin/zsh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORKBENCH_DIR="${NEURAL_WORKBENCH_DIR:-$HOME/Downloads/neural-workbench}"
WORKBENCH_URL="${NEURAL_WORKBENCH_URL:-http://127.0.0.1:3000}"
STATE_DIR="$HOME/.local/state/rtb"
WORKBENCH_LOG="$STATE_DIR/neural-workbench.log"
WYZE_DIR="$REPO_DIR/integrations/arvis/wyze"
LEGACY_ARVIS_ROOT="${ARVIS_DESKTOP_ROOT:-$HOME/Documents/RTB DAtabase/local-assistant 2}"
LEGACY_WYZE_ENV="$LEGACY_ARVIS_ROOT/.env.local"
ARVIS_DESKTOP_LOG="$LEGACY_ARVIS_ROOT/logs/arvis-app.log"

echo "A.R.V.I.S. unified startup"
echo "RTB OS: $REPO_DIR"
echo "A.R.V.I.S. desktop: $LEGACY_ARVIS_ROOT"
echo "Neural Workbench: $WORKBENCH_DIR"
echo "Source of truth: RTB OS / Supabase"

mkdir -p "$STATE_DIR"

if [[ ! -f "$WORKBENCH_DIR/package.json" ]]; then
  echo "Neural Workbench not found at $WORKBENCH_DIR" >&2
  echo "Set NEURAL_WORKBENCH_DIR before running this launcher if the project was moved." >&2
  exit 1
fi

# Reuse the existing local Wyze configuration without copying secrets into Git.
if [[ -f "$LEGACY_WYZE_ENV" && -d "$WYZE_DIR" ]]; then
  set -a
  source "$LEGACY_WYZE_ENV"
  set +a
  if [[ -n "${WYZE_API_KEY_ID:-}" ]]; then
    export WYZE_API_ID="$WYZE_API_KEY_ID"
  fi
  if [[ ! -e "$WYZE_DIR/.env" ]]; then
    ln -s "$LEGACY_WYZE_ENV" "$WYZE_DIR/.env"
  fi
  echo "Wyze API configuration: linked from existing A.R.V.I.S. config"
fi

# Apply the idempotent parent/iframe live-data and Main Brain bridge before startup.
node "$REPO_DIR/integrations/arvis/patch-neural-workbench.mjs" "$WORKBENCH_DIR"

# Apply RTB-owned Workbench component overrides so local AI Studio exports stay in sync.
node "$REPO_DIR/integrations/arvis/apply-workbench-overrides.mjs" "$WORKBENCH_DIR"

# Replace synthetic briefing/anomaly fallbacks with verified RTB OS-only behavior.
node "$REPO_DIR/integrations/arvis/harden-neural-workbench.mjs" "$WORKBENCH_DIR"

# Surface remaining legacy/fake telemetry and exposure risks on every launch.
node "$REPO_DIR/integrations/arvis/audit-neural-workbench.mjs" "$WORKBENCH_DIR"

# Refresh the protected localhost control runtime.
/bin/zsh "$REPO_DIR/integrations/ada-control/install.sh"

# Keep the control plane private when Tailscale is installed.
if command -v tailscale >/dev/null 2>&1; then
  tailscale serve --bg 8791 >/dev/null 2>&1 || true
fi

workbench_online() {
  /usr/bin/curl -fsS --max-time 2 "$WORKBENCH_URL/api/health" >/dev/null 2>&1
}

if workbench_online; then
  echo "Neural Workbench already running at $WORKBENCH_URL"
  echo "Restart it once if this is the first run after the bridge/hardening update."
else
  echo "Starting Neural Workbench..."
  (
    cd "$WORKBENCH_DIR"
    nohup npm run dev >> "$WORKBENCH_LOG" 2>&1 &
    echo $! > "$STATE_DIR/neural-workbench.pid"
  )
  for _ in {1..20}; do
    sleep 0.5
    if workbench_online; then
      echo "Neural Workbench online at $WORKBENCH_URL"
      break
    fi
  done
  if ! workbench_online; then
    echo "Neural Workbench did not become healthy. Check $WORKBENCH_LOG" >&2
    exit 1
  fi
fi

# Launch the real Electron A.R.V.I.S. desktop shell that has historically lived
# in local-assistant 2. This keeps the user's existing voice/device implementation
# while RTB OS and Neural Workbench become its unified data/control services.
if [[ -f "$LEGACY_ARVIS_ROOT/electron/main.cjs" ]]; then
  mkdir -p "$LEGACY_ARVIS_ROOT/logs"
  if pgrep -f "$LEGACY_ARVIS_ROOT/electron/main.cjs" >/dev/null 2>&1; then
    echo "A.R.V.I.S. desktop already running"
  else
    if [[ ! -x "$LEGACY_ARVIS_ROOT/node_modules/.bin/electron" ]]; then
      echo "Installing A.R.V.I.S. desktop dependencies..."
      (
        cd "$LEGACY_ARVIS_ROOT"
        /usr/bin/env npm install >> "$ARVIS_DESKTOP_LOG" 2>&1
      )
    fi
    echo "Opening A.R.V.I.S. desktop..."
    (
      cd "$LEGACY_ARVIS_ROOT"
      nohup "$LEGACY_ARVIS_ROOT/node_modules/.bin/electron" "$LEGACY_ARVIS_ROOT/electron/main.cjs" >> "$ARVIS_DESKTOP_LOG" 2>&1 &
      echo $! > "$STATE_DIR/arvis-desktop.pid"
    )
  fi
else
  echo "A.R.V.I.S. desktop entry not found at $LEGACY_ARVIS_ROOT/electron/main.cjs" >&2
  echo "Set ARVIS_DESKTOP_ROOT if the desktop project moved." >&2
fi

echo "A.R.V.I.S. control bridge: http://127.0.0.1:8791"
echo "Neural Workbench: $WORKBENCH_URL"
echo "A.R.V.I.S. desktop: $LEGACY_ARVIS_ROOT"
echo "RTB OS live-data bridge: enabled"
echo "RTB Workbench process views: synchronized"
echo "Synthetic briefing/anomaly fallbacks: disabled"
echo "Telemetry audit: $STATE_DIR/neural-workbench-audit.json"
echo "Startup complete."
