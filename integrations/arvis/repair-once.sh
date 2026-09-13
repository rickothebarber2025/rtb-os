#!/bin/zsh
set -euo pipefail

REPO="$HOME/Documents/rtb-os"
ARVIS="$HOME/Documents/RTB DAtabase/local-assistant 2"
WORKBENCH="$HOME/Downloads/neural-workbench"
STATE="$HOME/.local/state/rtb"
RTB_URL="http://127.0.0.1:5173"
WORKBENCH_URL="http://127.0.0.1:3000"
CONTROL_URL="http://127.0.0.1:8791"
mkdir -p "$STATE" "$ARVIS/logs"

cd "$REPO"

echo "=== 1. VERIFY SOURCE ==="
python3 -m py_compile integrations/ada-control/ada_control_server.py integrations/ada-control/operations_copilot.py integrations/ada-control/staff_reconciliation.py
npm run build >/tmp/rtb-os-repair-build.log 2>&1 || { tail -80 /tmp/rtb-os-repair-build.log; exit 1; }

echo "=== 2. START RTB OS UI ==="
if ! curl -fsS --max-time 2 "$RTB_URL" >/dev/null 2>&1; then
  pkill -f "vite.*5173" 2>/dev/null || true
  (
    cd "$REPO"
    nohup npm run dev -- --host 127.0.0.1 --port 5173 >"$STATE/rtb-os-ui.log" 2>&1 &
    echo $! > "$STATE/rtb-os-ui.pid"
  )
fi
for _ in {1..30}; do
  curl -fsS --max-time 2 "$RTB_URL" >/dev/null 2>&1 && break
  sleep .5
done
curl -fsS --max-time 3 "$RTB_URL" >/dev/null

echo "=== 3. START NEURAL WORKBENCH ==="
if ! curl -fsS --max-time 2 "$WORKBENCH_URL/api/health" >/dev/null 2>&1; then
  pkill -f "tsx server.ts" 2>/dev/null || true
  (
    cd "$WORKBENCH"
    nohup npm run dev >"$STATE/neural-workbench.log" 2>&1 &
    echo $! > "$STATE/neural-workbench.pid"
  )
fi
for _ in {1..30}; do
  curl -fsS --max-time 2 "$WORKBENCH_URL/api/health" >/dev/null 2>&1 && break
  sleep .5
done
curl -fsS --max-time 3 "$WORKBENCH_URL/api/health" >/dev/null

echo "=== 4. REPAIR CONTROL BRIDGE ==="
/bin/zsh integrations/ada-control/install.sh
sleep 1
curl -fsS --max-time 3 -H "Origin: http://localhost:5173" "$CONTROL_URL/api/health" >/dev/null

echo "=== 5. REPAIR ADA SYNC ==="
if ! launchctl print "gui/$(id -u)/com.rtb.ada-sync" >/dev/null 2>&1; then
  if /bin/zsh integrations/ada-sync/install_launch_agent.sh; then
    echo "Ada sync installed."
  else
    echo "Ada sync installer could not complete; control bridge remains usable." >&2
  fi
fi

echo "=== 6. REPAIR PRIVATE ACCESS ==="
if command -v tailscale >/dev/null 2>&1; then
  tailscale serve --bg 8791 >/dev/null 2>&1 || true
fi

echo "=== 7. ROUTE A.R.V.I.S. DESKTOP TO RTB OS ==="
node integrations/arvis/patch-desktop-shell.mjs "$ARVIS" "$RTB_URL"

echo "=== 8. RESTART A.R.V.I.S. DESKTOP ==="
pkill -f "$ARVIS/electron/main.cjs" 2>/dev/null || true
sleep 1
(
  cd "$ARVIS"
  nohup "$ARVIS/node_modules/.bin/electron" "$ARVIS/electron/main.cjs" >> "$ARVIS/logs/arvis-app.log" 2>&1 &
  echo $! > "$STATE/arvis-desktop.pid"
)
sleep 2

echo "=== 9. FINAL HEALTH ==="
printf "RTB OS UI: "
curl -fsS --max-time 3 "$RTB_URL" >/dev/null && echo OK
printf "Workbench: "
curl -fsS --max-time 3 "$WORKBENCH_URL/api/health" >/dev/null && echo OK
printf "Control API: "
curl -fsS --max-time 3 -H "Origin: http://localhost:5173" "$CONTROL_URL/api/health" >/dev/null && echo OK
printf "Ada sync: "
if launchctl print "gui/$(id -u)/com.rtb.ada-sync" >/dev/null 2>&1; then echo OK; else echo NOT_LOADED; fi
printf "Tailscale Serve: "
if command -v tailscale >/dev/null 2>&1 && tailscale serve status --json >/dev/null 2>&1; then echo OK; else echo CHECK; fi
printf "A.R.V.I.S. desktop: "
if pgrep -f "$ARVIS/electron/main.cjs" >/dev/null 2>&1; then echo OK; else echo FAILED; fi

echo "=== REPAIR COMPLETE ==="
echo "A.R.V.I.S. now opens RTB OS on $RTB_URL. Neural Workbench remains available inside the A.R.V.I.S. Control module at $WORKBENCH_URL."
