#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ADA_SYNC_ENV_FILE:-$HOME/.config/rtb/ada-sync.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ADA_SYNC_ERROR missing env file: $ENV_FILE" >&2
  exit 2
fi

set -a
source "$ENV_FILE"
set +a

exec /usr/bin/python3 "$SCRIPT_DIR/sync_ada_archive.py"
