#!/usr/bin/env bash
# Publish the generated ticker catalogue so the GitHub-connected Vercel app
# serves the same symbol universe as this VPS.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CATALOG_PATH="frontend-next/public/ticker_data.json"
LOCK_PATH="/tmp/valuation-publish-ticker-catalog.lock"

exec 9>"$LOCK_PATH"
if ! flock -n 9; then
    echo "Ticker catalogue publication is already running; skipping."
    exit 0
fi

cd "$ROOT_DIR"

if [[ "$(git branch --show-current)" != "main" ]]; then
    echo "Refusing to publish: expected branch main."
    exit 1
fi

if git diff --quiet -- "$CATALOG_PATH" && git diff --cached --quiet -- "$CATALOG_PATH"; then
    echo "Ticker catalogue is unchanged; nothing to publish."
    exit 0
fi

# Stage and commit this generated file only. Other local work is deliberately
# left untouched.
git add -- "$CATALOG_PATH"
git commit --only -m "chore(frontend): refresh ticker catalogue" -- "$CATALOG_PATH"
git push origin main

echo "Ticker catalogue published to GitHub; Vercel deployment will follow."
