#!/bin/zsh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORKBENCH_DIR="${NEURAL_WORKBENCH_DIR:-$HOME/Downloads/neural-workbench}"
WORKBENCH_URL="${NEURAL_WORKBENCH_URL:-http://127.0.0.1:3000}"
STATE_DIR="$HOME/.local/state/rtb"
WORKBENCH_LOG="$STATE_DIR/neural-workbench.log"

echo "A.R.V.I.S. local startup"
echo "RTB OS: $REPO_DIR"
echo "Neural Workbench: $WORKBENCH_DIR"

mkdir -p "$STATE_DIR"

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
elif [[ -f "$WORKBENCH_DIR/package.json" ]]; then
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
else
  echo "Neural Workbench not found at $WORKBENCH_DIR" >&2
  echo "Set NEURAL_WORKBENCH_DIR before running this launcher if the project was moved." >&2
  exit 1
fi

echo "A.R.V.I.S. control bridge: http://127.0.0.1:8791"
echo "Neural Workbench: $WORKBENCH_URL"
echo "Startup complete."
