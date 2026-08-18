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
python -m pip install -q --upgrade pip
python -m pip install -q -r requirements.txt
python -m pip install -q --no-deps 'git+https://github.com/leogomezz4t/PyTextNow_API.git@d54771ad1e52681a72e180d89db43f1ab975f854'

echo "Starting RTB TextNow Bridge on http://127.0.0.1:8795"
exec uvicorn app:app --host 127.0.0.1 --port 8795
