#!/bin/zsh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORKBENCH_DIR="${NEURAL_WORKBENCH_DIR:-$HOME/Downloads/neural-workbench}"
WORKBENCH_URL="${NEURAL_WORKBENCH_URL:-http://127.0.0.1:3000}"
STATE_DIR="$HOME/.local/state/rtb"
WORKBENCH_LOG="$STATE_DIR/neural-workbench.log"
WYZE_DIR="$REPO_DIR/integrations/arvis/wyze"
LEGACY_ARVIS_ROOT="${ARVIS_DESKTOP_ROOT:-$HOME/Documents/RTB DAtabase/local-assistant 2}"
LEGACY_ENV="$LEGACY_ARVIS_ROOT/.env.local"
RTB_OS_ENV="$REPO_DIR/.env"
WORKBENCH_ENV="$WORKBENCH_DIR/.env"
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

# Read individual KEY=value entries without sourcing arbitrary .env content.
# This prevents text values containing spaces/commas from being executed as shell commands.
read_env_value() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 1
  local line
  line="$(/usr/bin/grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" 2>/dev/null | /usr/bin/tail -n 1 || true)"
  [[ -n "$line" ]] || return 1
  local value="${line#*=}"
  value="${value##[[:space:]]#}"
  value="${value%%[[:space:]]#}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  print -r -- "$value"
}

first_env_value() {
  local key="$1"
  local value=""
  local file
  for file in "$WORKBENCH_ENV" "$RTB_OS_ENV" "$LEGACY_ENV"; do
    value="$(read_env_value "$file" "$key" || true)"
    if [[ -n "$value" ]]; then
      print -r -- "$value"
      return 0
    fi
  done
  return 1
}

# Reuse only the Wyze keys we actually need. Never source the whole legacy .env.
if [[ -f "$LEGACY_ENV" && -d "$WYZE_DIR" ]]; then
  wyze_id="$(read_env_value "$LEGACY_ENV" "WYZE_API_KEY_ID" || true)"
  wyze_key="$(read_env_value "$LEGACY_ENV" "WYZE_API_KEY" || true)"
  wyze_email="$(read_env_value "$LEGACY_ENV" "WYZE_EMAIL" || true)"
  wyze_password="$(read_env_value "$LEGACY_ENV" "WYZE_PASSWORD" || true)"
  [[ -n "$wyze_id" ]] && export WYZE_API_ID="$wyze_id"
  [[ -n "$wyze_key" ]] && export WYZE_API_KEY="$wyze_key"
  [[ -n "$wyze_email" ]] && export WYZE_EMAIL="$wyze_email"
  [[ -n "$wyze_password" ]] && export WYZE_PASSWORD="$wyze_password"
  if [[ ! -e "$WYZE_DIR/.env" ]]; then
    ln -s "$LEGACY_ENV" "$WYZE_DIR/.env"
  fi
  if [[ -n "${WYZE_API_ID:-}" && -n "${WYZE_API_KEY:-}" ]]; then
    echo "Wyze API configuration: detected"
  else
    echo "Wyze API configuration: incomplete"
  fi
fi

# Square can be configured once in Workbench .env, RTB OS .env, or legacy A.R.V.I.S. .env.local.
# Values are exported only to the local Workbench process; secrets are never printed.
for square_key in SQUARE_ACCESS_TOKEN SQUARE_LOCATION_ID_LOUNGE SQUARE_LOCATION_ID_BEAUTY; do
  square_value="$(first_env_value "$square_key" || true)"
  if [[ -n "$square_value" ]]; then
    export "$square_key=$square_value"
  fi
done

if [[ -n "${SQUARE_ACCESS_TOKEN:-}" ]]; then
  echo "Square access token: detected"
else
  echo "Square access token: not detected"
fi
[[ -n "${SQUARE_LOCATION_ID_LOUNGE:-}" ]] && echo "Square Lounge location ID: detected" || echo "Square Lounge location ID: not detected"
[[ -n "${SQUARE_LOCATION_ID_BEAUTY:-}" ]] && echo "Square Beauty location ID: detected" || echo "Square Beauty location ID: not detected"

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
  if [[ -n "${SQUARE_ACCESS_TOKEN:-}" ]]; then
    echo "Square token is available to this launcher. If you just changed it, restart Workbench so the running process receives the new value."
  fi
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

# Report Square connectivity without displaying credentials.
square_status_json="$(/usr/bin/curl -fsS --max-time 4 "$WORKBENCH_URL/api/square/status" 2>/dev/null || true)"
if [[ -n "$square_status_json" ]]; then
  SQUARE_STATUS_JSON="$square_status_json" /usr/bin/env node - <<'NODE'
try {
  const status = JSON.parse(process.env.SQUARE_STATUS_JSON || '{}');
  const connected = status.connected ?? status.configured ?? status.live ?? status.status === 'connected';
  const tokenConfigured = status.tokenConfigured ?? status.hasAccessToken ?? status.accessTokenConfigured;
  const live = status.live ?? status.apiReachable ?? status.connected;
  console.log(`Square Workbench status: ${connected === true || live === true ? 'CONNECTED' : connected === false ? 'NOT CONNECTED' : 'STATUS AVAILABLE'}`);
  if (typeof tokenConfigured === 'boolean') console.log(`Square token recognized by Workbench: ${tokenConfigured ? 'yes' : 'no'}`);
  if (status.error) console.log(`Square status error: ${String(status.error).slice(0, 240)}`);
} catch {
  console.log('Square Workbench status: endpoint responded but returned unreadable status');
}
NODE
else
  echo "Square Workbench status: unavailable"
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
