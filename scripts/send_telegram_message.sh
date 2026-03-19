#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/var/www/valuation/.telegram_uptime.env"
MESSAGE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --message)
      MESSAGE="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$MESSAGE" ]; then
  # Accept multi-line message through stdin for easier remote automation.
  MESSAGE="$(cat || true)"
fi

if [ -z "${MESSAGE:-}" ]; then
  echo "Message is empty"
  exit 2
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing in $ENV_FILE"
  exit 1
fi

curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${MESSAGE}" \
  >/dev/null

echo "Telegram message sent"
