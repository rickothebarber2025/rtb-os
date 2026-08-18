#!/bin/zsh
set -e

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and add the TextNow session values first."
  exit 1
fi

set -a
source .env
set +a

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -q -r requirements.txt

echo "Starting RTB TextNow Bridge on http://127.0.0.1:8795"
exec uvicorn app:app --host 127.0.0.1 --port 8795
