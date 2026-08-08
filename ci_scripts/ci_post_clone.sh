#!/bin/sh
set -e

cd "${CI_PRIMARY_REPOSITORY_PATH:-$(pwd)}"

echo "Installing RTB OS JavaScript dependencies for Xcode Cloud..."
npm install --no-audit --no-fund

echo "Building RTB OS web assets..."
npm run build

echo "Syncing Capacitor iOS dependencies..."
npx cap sync ios
