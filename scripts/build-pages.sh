#!/usr/bin/env bash
# Assemble Cloudflare Pages output: static public/ + Vite app at /app/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"
npm ci
npm run lint
npm run build
cd "$ROOT"
rm -rf deploy
mkdir -p deploy
cp -R public/. deploy/
mkdir -p deploy/app
cp -R frontend/dist/. deploy/app/
echo "Pages bundle ready at ./deploy (upload this directory to Cloudflare Pages)."
