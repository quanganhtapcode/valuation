#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-/var/www/valuation/.telegram_uptime.env}"

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

HOSTNAME="$(hostname)"
NOW="$(date '+%Y-%m-%d %H:%M:%S %Z')"
UPTIME_HUMAN="$(uptime -p 2>/dev/null || true)"
LOAD_AVG="$(cut -d ' ' -f1-3 /proc/loadavg 2>/dev/null || echo 'n/a')"
MEMORY="$(free -h | awk '/Mem:/ {print $3"/"$2}' 2>/dev/null || echo 'n/a')"
DISK="$(df -h / | awk 'NR==2 {print $3"/"$2" ("$5")"}' 2>/dev/null || echo 'n/a')"

SERVICE_NAME="valuation"
SERVICE_STATUS="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo 'unknown')"

HEALTH_URL="http://localhost:8000/health"
HEALTH_RAW="$(curl -sS --max-time 8 "$HEALTH_URL" 2>/dev/null || true)"
if [ -n "$HEALTH_RAW" ]; then
  HEALTH_SUMMARY="$(echo "$HEALTH_RAW" | tr -d '\n' | cut -c1-220)"
else
  HEALTH_SUMMARY="unreachable"
fi

MSG="📡 *Valuation Uptime Report*%0A"
MSG+="🖥 Host: *${HOSTNAME}*%0A"
MSG+="🕒 Time: ${NOW}%0A"
MSG+="⏱ Uptime: ${UPTIME_HUMAN}%0A"
MSG+="📈 Load(1/5/15): ${LOAD_AVG}%0A"
MSG+="🧠 Memory: ${MEMORY}%0A"
MSG+="💽 Disk /: ${DISK}%0A"
MSG+="🧩 Service(${SERVICE_NAME}): *${SERVICE_STATUS}*%0A"
MSG+="🌐 Health: ${HEALTH_SUMMARY}"

curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  -d "text=${MSG}" \
  -d "parse_mode=Markdown" \
  >/dev/null

echo "Sent uptime report at ${NOW}"
