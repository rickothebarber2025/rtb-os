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
ADA_SYNC_ENV="$HOME/.config/rtb/ada-sync.env"
if [[ -f "$ADA_SYNC_ENV" ]] && grep -q 'PASTE_SERVICE_ROLE_KEY_HERE' "$ADA_SYNC_ENV"; then
  key=""
  for envfile in "$REPO/.env" "$REPO/.env.local" "$WORKBENCH/.env" "$WORKBENCH/.env.local" "$ARVIS/.env" "$ARVIS/.env.local"; do
    [[ -f "$envfile" ]] || continue
    key="$(grep -E '^(SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_SERVICE_ROLE_KEY)=' "$envfile" 2>/dev/null | head -n 1 | cut -d= -f2- || true)"
    [[ -n "$key" ]] && break
  done
  if [[ -n "$key" ]]; then
    python3 - "$ADA_SYNC_ENV" "$key" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); key = sys.argv[2]
s = p.read_text()
s = s.replace('SUPABASE_SERVICE_ROLE_KEY=PASTE_SERVICE_ROLE_KEY_HERE', f'SUPABASE_SERVICE_ROLE_KEY={key}')
p.write_text(s)
PY
    chmod 600 "$ADA_SYNC_ENV"
    echo "Ada sync recovered an existing local Supabase service key without printing it."
  fi
fi
if ! launchctl print "gui/$(id -u)/com.rtb.ada-sync" >/dev/null 2>&1; then
  if /bin/zsh integrations/ada-sync/install_launch_agent.sh; then
    echo "Ada sync installed."
  else
    echo "Ada sync installer could not complete; continuing with the rest of the repair." >&2
  fi
fi

echo "=== 6. REPAIR PRIVATE ACCESS ==="
if command -v tailscale >/dev/null 2>&1; then
  tailscale serve --bg 8791 >/dev/null 2>&1 || true
fi

echo "=== 7. ROUTE A.R.V.I.S. DESKTOP TO RTB OS ==="
if ! node integrations/arvis/patch-desktop-shell.mjs "$ARVIS" "$RTB_URL"; then
  echo "Primary routing patcher could not identify the desktop route." >&2
  if command -v claude >/dev/null 2>&1; then
    echo "Claude CLI detected. Handing only the desktop routing repair to Claude..."
    claude -p "Inspect '$ARVIS/electron/main.cjs'. The A.R.V.I.S. Electron desktop currently opens the wrong frontend. Change ONLY the primary BrowserWindow navigation so the app opens http://127.0.0.1:5173 instead of Neural Workbench/port 3000 or any computed Workbench URL. Preserve all IPC, preload, device, voice, screen and backend startup logic. Make a backup before editing. Do not touch unrelated files. After editing, syntax-check the file with node --check. Return a short summary." || true
  else
    echo "Claude CLI is not installed. Diagnostic: $ARVIS/logs/desktop-shell-routing-diagnostic.txt" >&2
  fi
fi

# Refuse to restart a syntactically broken Electron main process.
node --check "$ARVIS/electron/main.cjs"

echo "=== 8. RESTART A.R.V.I.S. DESKTOP ==="
pkill -f "$ARVIS/electron/main.cjs" 2>/dev/null || true
sleep 1
(
  cd "$ARVIS"
  nohup "$ARVIS/node_modules/.bin/electron" "$ARVIS/electron/main.cjs" >> "$ARVIS/logs/arvis-app.log" 2>&1 &
  echo $! > "$STATE/arvis-desktop.pid"
)
sleep 3

echo "=== 9. FINAL HEALTH ==="
printf "RTB OS UI: "
curl -fsS --max-time 3 "$RTB_URL" >/dev/null && echo OK || echo FAILED
printf "Workbench: "
curl -fsS --max-time 3 "$WORKBENCH_URL/api/health" >/dev/null && echo OK || echo FAILED
printf "Control API: "
curl -fsS --max-time 3 -H "Origin: http://localhost:5173" "$CONTROL_URL/api/health" >/dev/null && echo OK || echo FAILED
printf "Ada sync: "
if launchctl print "gui/$(id -u)/com.rtb.ada-sync" >/dev/null 2>&1; then echo OK; else echo NOT_LOADED; fi
printf "Tailscale Serve: "
if command -v tailscale >/dev/null 2>&1 && tailscale serve status --json >/dev/null 2>&1; then echo OK; else echo CHECK; fi
printf "A.R.V.I.S. desktop: "
if pgrep -f "$ARVIS/electron/main.cjs" >/dev/null 2>&1; then echo OK; else echo FAILED; fi
printf "Desktop target: "
if grep -q 'RTB_DESKTOP_SHELL_TARGET=http://127.0.0.1:5173' "$ARVIS/electron/main.cjs" 2>/dev/null || grep -q '127.0.0.1:5173' "$ARVIS/electron/main.cjs" 2>/dev/null; then echo RTB_OS; else echo CHECK; fi

echo "=== REPAIR COMPLETE ==="
echo "A.R.V.I.S. should open RTB OS on $RTB_URL. Neural Workbench remains a subordinate module at $WORKBENCH_URL."
