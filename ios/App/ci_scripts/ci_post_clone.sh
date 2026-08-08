#!/bin/sh
set -e

REPO_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$REPO_ROOT"

echo "Installing RTB OS dependencies for Xcode Cloud..."
npm install --no-audit --no-fund

echo "Building RTB OS web bundle..."
npm run build

echo "Syncing Capacitor iOS packages..."
npx cap sync ios
