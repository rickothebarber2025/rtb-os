#!/bin/sh
set -e

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$REPO_ROOT"

echo "Preparing Node.js for RTB OS..."
if ! command -v node >/dev/null 2>&1; then
  brew install node
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node --version
npm --version

echo "Installing RTB OS dependencies..."
npm install --no-audit --no-fund

echo "Building RTB OS web bundle..."
npm run build

echo "Syncing Capacitor iOS packages..."
npx cap sync ios
