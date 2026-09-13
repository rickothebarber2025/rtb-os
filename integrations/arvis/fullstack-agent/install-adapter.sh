#!/bin/zsh
set -euo pipefail

# A.R.V.I.S. adapter for Jared Rhodenizer's fullstack-agent stack.
# This intentionally ADOPTS the existing A.R.V.I.S. identity and does not run
# the upstream fresh-agent wizard, overwrite CLAUDE.md, or replace RTB OS data.

REPO_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ARVIS_ROOT="${ARVIS_DESKTOP_ROOT:-$HOME/Documents/RTB DAtabase/local-assistant 2}"
STACK_ROOT="${ARVIS_FULLSTACK_ROOT:-$HOME/.local/share/rtb/arvis-fullstack}"
STATE_DIR="$HOME/.local/state/rtb"
mkdir -p "$STACK_ROOT" "$STATE_DIR"

echo "A.R.V.I.S. fullstack adoption adapter"
echo "Existing A.R.V.I.S.: $ARVIS_ROOT"
echo "Component home: $STACK_ROOT"
echo "RTB OS remains the business source of truth."

clone_or_update() {
  local name="$1"
  local url="https://github.com/jaredrhod/$name.git"
  local dir="$STACK_ROOT/$name"
  if [[ -d "$dir/.git" ]]; then
    echo "[$name] existing component found; updating without replacing local files"
    git -C "$dir" pull --ff-only || echo "[$name] update skipped; local changes preserved"
  elif [[ -e "$dir" ]]; then
    echo "[$name] existing non-git directory preserved: $dir"
  else
    echo "[$name] installing"
    git clone --depth 1 "$url" "$dir"
  fi
}

# Adopt only the useful runtime pieces. Memory is deliberately not auto-installed:
# RTB OS/Supabase + Main Brain remain authoritative and an Obsidian migration must
# never silently replace or fork that memory architecture.
clone_or_update backtalk
clone_or_update ai-visualizer
clone_or_update barehands

cat > "$STACK_ROOT/ARVIS_ADOPTION.md" <<EOF
# A.R.V.I.S. adoption contract

- Identity: A.R.V.I.S. (existing agent; do not replace with Jarvis)
- Business source of truth: RTB OS / Supabase
- Existing desktop: $ARVIS_ROOT
- Neural Workbench: ${NEURAL_WORKBENCH_DIR:-$HOME/Downloads/neural-workbench}
- backtalk: optional voice runtime; must not overwrite the existing A.R.V.I.S. desktop
- ai-visualizer: optional face/status surface
- barehands: optional gesture surface; camera permission is user-controlled
- ai-memory-vault: intentionally not auto-installed; RTB Main Brain remains authoritative
- Never overwrite, delete, or move the existing A.R.V.I.S. project.
EOF

cat > "$STATE_DIR/arvis-fullstack.env" <<EOF
ARVIS_FULLSTACK_ROOT=$STACK_ROOT
ARVIS_BACKTALK_DIR=$STACK_ROOT/backtalk
ARVIS_VISUALIZER_DIR=$STACK_ROOT/ai-visualizer
ARVIS_BAREHANDS_DIR=$STACK_ROOT/barehands
EOF

echo "A.R.V.I.S. fullstack components staged successfully."
echo "Voice, face and hands are available for wiring; existing A.R.V.I.S. remains intact."
